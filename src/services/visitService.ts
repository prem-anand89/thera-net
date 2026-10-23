import {
  clinicBillingConfig,
  type CatalogItem,
  type Visit,
  type VisitCredit,
  type VisitItem,
  type UUID,
} from '@/domain/types';
import { roundToRupeeHalfUp, type Paise } from '@/domain/money';
import { computeVisitSplit } from '@/domain/split';
import {
  SHARE_BELOW_PACKAGE,
  SHARE_BELOW_ZERO,
  SHARE_TOO_LARGE,
  autoCredits,
  packageHolder,
  type CreditShare,
} from '@/domain/visitLines';
import type { Repos } from '@/repositories/types';

/** One service on a visit, as the caller describes it. */
export interface VisitLineInput {
  serviceCatalogId: UUID;
  /** Someone other than the visit's therapist who delivered this service; omit/null = the visit's therapist. */
  assistingTherapistId?: UUID | null;
  /**
   * Makes this line the ₹0 session of an existing package (billed on an earlier visit). Without it, a
   * catalog service with more than one session is a new package purchase.
   */
  packageContinuation?: { packageGroupId: UUID; sessionIndex: number; packageTotal: number };
}

const VISIT_DELETED = 'This visit was deleted.';
const LINES_FROZEN = 'This visit is on an invoice; its services are frozen.';
const NOT_IN_CLINIC = "That therapist isn't part of this clinic.";
const SHARES_DONT_ADD_UP = 'The shares must add up to the bill.';

export interface NewVisitInput {
  clinicId: UUID;
  patientId: UUID;
  therapistId: UUID;
  visitDate: string;
  /**
   * The services performed, in display order; the first is the visit's main service. Use this for new
   * callers. The single-service fields below (`serviceCatalogId`, `isContinuation`, `sessionIndex`,
   * `packageTotal`, `packageGroupId`) still work and become one line.
   */
  lines?: VisitLineInput[];
  serviceCatalogId?: UUID;
  condition?: string | null;
  treatmentNotes?: string | null;
  /** Treatment types performed this visit — TreatmentItem catalog ids. */
  treatmentIds?: UUID[];
  /** Omit to bill the catalog price; any difference requires a reason */
  actualBillPaise?: Paise;
  adjustmentReason?: string | null;
  sessionIndex?: number | null;
  packageTotal?: number | null;
  /** Set when logging session 2..N of an existing package */
  packageGroupId?: UUID | null;
  /**
   * ₹0 continuation session of a package billed on an earlier visit. The
   * catalog-price snapshot is 0 here (the package price lives on the billed
   * visit), so a zero bill is recorded as normal — not as a 100% discount.
   */
  isContinuation?: boolean;
  /**
   * Set when the therapist explicitly marks the bill "collect later" at
   * logging time, instead of paying immediately. Optional free-text reason —
   * surfaced on the Workspace pending-work list. Absence of a Payment row
   * (not this field) is what actually drives outstanding calculations.
   */
  pendingPaymentNote?: string | null;
}

export function createVisitService(repos: Repos) {
  /** What a line is, before it becomes a row: the service plus the package facts that decide its price. */
  interface LineSpec {
    serviceCatalogId: UUID;
    assistingTherapistId: UUID | null;
    isPackage: boolean;
    /** A package session billed on an earlier visit: the line's price is ₹0. */
    zeroPrice: boolean;
    continuation?: VisitLineInput['packageContinuation'];
  }

  /** Bill vs. catalog total → the stored bill and adjustment, with the usual reason rule. */
  function billFor(catalogPricePaise: Paise, actualBillPaise: Paise | undefined, reason?: string | null) {
    const bill = actualBillPaise ?? catalogPricePaise;
    if (bill < 0) throw new Error('Bill amount cannot be negative');
    const adjustmentPaise = bill - catalogPricePaise;
    if (adjustmentPaise !== 0 && !reason?.trim()) {
      throw new Error('An adjustment reason is required when the bill differs from the catalog price');
    }
    return { actualBillPaise: bill, adjustmentPaise };
  }

  async function loadClinic(clinicId: UUID) {
    const clinic = await repos.clinics.get(clinicId);
    if (!clinic) throw new Error(`Clinic not found (id: ${clinicId})`);
    return clinic;
  }

  async function loadCatalog(specs: LineSpec[]): Promise<Map<UUID, CatalogItem>> {
    const byId = new Map<UUID, CatalogItem>();
    for (const sp of specs) {
      if (byId.has(sp.serviceCatalogId)) continue;
      const item = await repos.catalog.get(sp.serviceCatalogId);
      if (!item) throw new Error(`Catalog service not found (id: ${sp.serviceCatalogId})`);
      byId.set(sp.serviceCatalogId, item);
    }
    return byId;
  }

  /**
   * The checks the server would otherwise reject permanently (and the sync then revert the row): one
   * package per visit, an assistant who is not the visit's therapist, and everyone in the visit's clinic.
   */
  async function checkSpecs(clinicId: UUID, primaryId: UUID, specs: LineSpec[]) {
    if (specs.length === 0) throw new Error('A visit needs at least one service.');
    if (specs.filter((s) => s.isPackage).length > 1) throw new Error('Only one package per visit.');
    const assistants = new Set<UUID>();
    for (const sp of specs) {
      if (sp.assistingTherapistId === primaryId) {
        throw new Error("The assisting therapist must be someone other than the visit's therapist.");
      }
      if (sp.assistingTherapistId) assistants.add(sp.assistingTherapistId);
    }
    await assertInClinic(clinicId, [...assistants]);
  }

  async function assertInClinic(clinicId: UUID, therapistIds: UUID[]) {
    if (therapistIds.length === 0) return;
    const roster = new Set((await repos.therapists.list(clinicId, true)).map((t) => t.id));
    if (therapistIds.some((id) => !roster.has(id))) throw new Error(NOT_IN_CLINIC);
  }

  function specsFromLines(lines: VisitLineInput[]): LineSpec[] {
    return lines.map((l) => ({
      serviceCatalogId: l.serviceCatalogId,
      assistingTherapistId: l.assistingTherapistId ?? null,
      isPackage: false, // decided against the catalog in `withPackageFlags`
      zeroPrice: Boolean(l.packageContinuation),
      continuation: l.packageContinuation,
    }));
  }

  /**
   * Which existing row each spec reuses: the same service at the same position first, else the first
   * unused row of that service. Shared by the package-flag step and `reconcileLines` so both agree.
   */
  function matchExisting(specs: LineSpec[], existing: VisitItem[]): (VisitItem | undefined)[] {
    const pool = [...existing];
    return specs.map((sp, position) => {
      let at = pool.findIndex((e) => e.serviceCatalogId === sp.serviceCatalogId && e.position === position);
      if (at < 0) at = pool.findIndex((e) => e.serviceCatalogId === sp.serviceCatalogId);
      return at < 0 ? undefined : pool.splice(at, 1)[0];
    });
  }

  /**
   * New-API lines: a continuation, or a NEW line for a service with several sessions, is the package
   * line. A line that already exists keeps the flag it was saved with — today's catalog session count
   * (which may have been edited since) never re-decides it.
   */
  function withPackageFlags(
    specs: LineSpec[],
    catalog: Map<UUID, CatalogItem>,
    existing: VisitItem[] = []
  ): LineSpec[] {
    const matched = matchExisting(specs, existing);
    return specs.map((sp, i) => ({
      ...sp,
      isPackage: sp.continuation
        ? true
        : matched[i]
          ? matched[i]!.isPackageLine
          : (catalog.get(sp.serviceCatalogId)?.sessionCount ?? 1) > 1,
    }));
  }

  function freshLine(
    visitId: UUID,
    clinicId: UUID,
    position: number,
    sp: LineSpec,
    item: CatalogItem,
    now: string
  ): VisitItem {
    return {
      id: crypto.randomUUID(),
      clinicId,
      visitId,
      position,
      serviceCatalogId: item.id,
      serviceName: item.name,
      catalogPricePaise: item.basePricePaise,
      pricePaise: sp.zeroPrice ? 0 : item.basePricePaise,
      assistingTherapistId: sp.assistingTherapistId,
      durationMinutes: item.durationMinutes ?? null,
      isPackageLine: sp.isPackage,
      deleted: false,
      updatedAt: now,
    };
  }

  /**
   * Lines to write for an edit, keeping every untouched row untouched (so a concurrent edit to another
   * line is never overwritten) and reusing the row of a service that is still there. Snapshots (name,
   * price, duration) stay as entered unless the line's package-ness or ₹0-ness changed. The returned
   * `rows` are in PUSH ORDER: anything that frees the visit's single package slot (a removed package
   * line, or one no longer flagged) comes before anything that takes it, so the server never sees two
   * live package lines.
   * Known gap: the sync merges all queued entries for one row at its OLDEST queue position, so if the
   * slot-taking row already had an older pending entry, the order can invert (rare). The server then
   * answers 23505 (one live package line per visit) and the row reverts. Worth a later fix in the outbox.
   */
  function reconcileLines(
    visitId: UUID,
    clinicId: UUID,
    specs: LineSpec[],
    catalog: Map<UUID, CatalogItem>,
    existing: VisitItem[],
    now: string
  ) {
    const matched = matchExisting(specs, existing);
    const pool = [...existing];
    const live: VisitItem[] = [];
    const releasing: VisitItem[] = [];
    const taking: VisitItem[] = [];
    let keptPackage = false;
    specs.forEach((sp, position) => {
      const fresh = freshLine(visitId, clinicId, position, sp, catalog.get(sp.serviceCatalogId)!, now);
      const old = matched[position];
      if (!old) {
        live.push(fresh);
        taking.push(fresh);
        return;
      }
      pool.splice(pool.indexOf(old), 1);
      const sameSnapshot =
        old.isPackageLine === fresh.isPackageLine && (old.pricePaise === 0) === (fresh.pricePaise === 0);
      const next: VisitItem = sameSnapshot
        ? { ...old, position, assistingTherapistId: sp.assistingTherapistId }
        : { ...fresh, id: old.id, createdBy: old.createdBy };
      if (sp.isPackage && old.isPackageLine) keptPackage = true;
      live.push(next);
      const changed =
        next.position !== old.position ||
        next.assistingTherapistId !== old.assistingTherapistId ||
        next.isPackageLine !== old.isPackageLine ||
        next.pricePaise !== old.pricePaise ||
        next.serviceName !== old.serviceName ||
        next.durationMinutes !== old.durationMinutes;
      if (!changed) return;
      const written = { ...next, updatedAt: now };
      live[live.length - 1] = written;
      (old.isPackageLine && !written.isPackageLine ? releasing : taking).push(written);
    });
    const removed = pool.map((e) => ({ ...e, deleted: true, updatedAt: now }));
    const frees = [...removed.filter((r) => r.isPackageLine), ...releasing];
    const rest = [...removed.filter((r) => !r.isPackageLine), ...taking];
    return { live, rows: [...frees, ...rest], keptPackage };
  }

  /**
   * Share rows to write so the visit's live shares equal `shares`: unchanged rows are left alone, a
   * therapist keeps their row (and id) when only the amount moves, new therapists get a row, and rows
   * for anyone no longer in `shares` are soft-deleted.
   */
  function creditRows(visit: Visit, existing: VisitCredit[], shares: CreditShare[], now: string): VisitCredit[] {
    const out: VisitCredit[] = [];
    const pool = [...existing];
    for (const share of shares) {
      const at = pool.findIndex((c) => c.therapistId === share.therapistId);
      if (at < 0) {
        out.push({
          id: crypto.randomUUID(),
          clinicId: visit.clinicId,
          visitId: visit.id,
          therapistId: share.therapistId,
          amountPaise: share.amountPaise,
          deleted: false,
          updatedAt: now,
        });
        continue;
      }
      const [row] = pool.splice(at, 1);
      if (row.amountPaise !== share.amountPaise) out.push({ ...row, amountPaise: share.amountPaise, updatedAt: now });
    }
    for (const row of pool) out.push({ ...row, deleted: true, updatedAt: now });
    return out;
  }

  /** A legacy visit: its split lives only in the old shared_* columns, with no share rows yet. */
  function isLegacySplit(visit: Visit, credits: VisitCredit[]) {
    return credits.length === 0 && Boolean(visit.sharedTherapistId);
  }

  return {
    /**
     * Saves a visit with its service lines and automatic revenue shares. Visit, lines and shares go
     * through ONE local transaction, queued in that order, so the parent reaches the server before its
     * children. `visits.service_catalog_id` is the first line; the package columns come from the package
     * line. Shares are the 'auto' ones (`autoCredits`) — a clinic with the therapist split off still gets
     * one share, the primary's, equal to the bill.
     */
    async create(input: NewVisitInput): Promise<Visit> {
      const clinic = await loadClinic(input.clinicId);
      let specs: LineSpec[];
      let legacyPackage = false;
      if (input.lines?.length) {
        if (input.isContinuation || input.packageGroupId || input.sessionIndex != null) {
          throw new Error(
            'Give package details on the lines (packageContinuation), not alongside them.'
          );
        }
        specs = specsFromLines(input.lines);
      } else if (input.serviceCatalogId) {
        // The old single-service shape: one line, its package-ness decided as it always was.
        specs = [
          {
            serviceCatalogId: input.serviceCatalogId,
            assistingTherapistId: null,
            isPackage: false,
            zeroPrice: Boolean(input.isContinuation),
          },
        ];
        legacyPackage = true;
      } else {
        throw new Error('A visit needs at least one service.');
      }
      const catalog = await loadCatalog(specs);
      if (legacyPackage) {
        const item = catalog.get(specs[0].serviceCatalogId)!;
        specs[0].isPackage = (input.packageTotal ?? item.sessionCount) > 1;
      } else {
        specs = withPackageFlags(specs, catalog);
      }
      await checkSpecs(input.clinicId, input.therapistId, specs);
      // A package session can only continue this patient's own package.
      for (const sp of specs) {
        if (!sp.continuation) continue;
        const group = await repos.visits.listByPackageGroup(sp.continuation.packageGroupId);
        if (group.some((v) => !v.deleted && v.patientId !== input.patientId)) {
          throw new Error('That package belongs to another patient.');
        }
      }

      const visitId = crypto.randomUUID();
      const now = new Date().toISOString();
      const items = specs.map((sp, i) =>
        freshLine(visitId, input.clinicId, i, sp, catalog.get(sp.serviceCatalogId)!, now)
      );
      const catalogPricePaise = items.reduce((sum, l) => sum + l.pricePaise, 0);
      const { actualBillPaise, adjustmentPaise } = billFor(
        catalogPricePaise,
        input.actualBillPaise,
        input.adjustmentReason
      );

      // In simple (non-hospital) mode the split degenerates: the whole bill is
      // the clinic's, no tax withheld. Snapshots stored as 100 / 0 keep the
      // visit self-consistent (share=bill, post-tax=bill, tds=0, hv=0) so
      // reports reconcile and the immutability trigger stays satisfied.
      const { partnerSplit, therapistSplit } = clinicBillingConfig(clinic);
      const splitPct = partnerSplit ? clinic.clinicSplitPct : 100;
      const taxPct = partnerSplit ? clinic.taxPct : 0;
      const tdsBasis = partnerSplit ? clinic.tdsBasis : 'gross_bill';
      const split = computeVisitSplit(actualBillPaise, splitPct, taxPct, tdsBasis);

      const pkgSpec = specs.find((s) => s.isPackage);
      const pkgItem = pkgSpec ? catalog.get(pkgSpec.serviceCatalogId)! : undefined;
      let pkg: { sessionIndex: number | null; packageTotal: number | null; packageGroupId: UUID | null };
      if (legacyPackage) {
        const isPackage = Boolean(pkgSpec);
        const item = catalog.get(specs[0].serviceCatalogId)!;
        pkg = {
          sessionIndex: input.sessionIndex ?? (isPackage ? 1 : null),
          packageTotal: input.packageTotal ?? (isPackage ? item.sessionCount : null),
          packageGroupId: input.packageGroupId ?? (isPackage ? crypto.randomUUID() : null),
        };
      } else if (pkgSpec?.continuation) {
        pkg = { ...pkgSpec.continuation };
      } else if (pkgItem) {
        pkg = { sessionIndex: 1, packageTotal: pkgItem.sessionCount, packageGroupId: crypto.randomUUID() };
      } else {
        pkg = { sessionIndex: null, packageTotal: null, packageGroupId: null };
      }

      const visit: Visit = {
        id: visitId,
        clinicId: input.clinicId,
        patientId: input.patientId,
        therapistId: input.therapistId,
        visitDate: input.visitDate,
        condition: input.condition?.trim() || null,
        treatmentNotes: input.treatmentNotes?.trim() || null,
        treatmentIds: input.treatmentIds ?? [],
        serviceCatalogId: items[0].serviceCatalogId,
        catalogPricePaise,
        actualBillPaise,
        adjustmentPaise,
        adjustmentReason: adjustmentPaise !== 0 ? (input.adjustmentReason?.trim() ?? null) : null,
        ...pkg,
        // Rate snapshots: historical visits keep the split that was active
        // when they were billed, even if the clinic renegotiates later.
        clinicSplitPct: splitPct,
        taxPct,
        tdsBasis,
        clinicSharePaise: split.clinicSharePaise,
        postTaxPaise: split.postTaxPaise,
        tdsPaise: split.tdsPaise,
        partnerSharePaise: split.partnerSharePaise,
        invoiceId: null,
        pendingPaymentNote: input.pendingPaymentNote?.trim() || null,
        creditsMode: 'auto',
        deleted: false,
        // Flags the visit for a clinical note until one is completed against
        // it (see consultationNoteService.saveAssessment, which closes this
        // out). Gated on the clinic opting in, not on the patient already
        // having a documentation enrollment — an enrollment is only ever
        // created lazily when a note is first opened, so gating on it would
        // mean a patient's very first visit could never prompt for their
        // first note.
        ...(clinic.clinicalDocsEnabled ? { clinicalStatus: 'pending' as const } : {}),
        updatedAt: now,
      };
      const credits = creditRows(
        visit,
        [],
        autoCredits(items, visit.therapistId, actualBillPaise, { splitEnabled: therapistSplit }),
        now
      );
      await repos.visits.putWithChildren(visit, items, credits);
      return visit;
    },

    /**
     * Replaces an uninvoiced visit's services. The bill is `adjustment.actualBillPaise`, or, when
     * omitted, the new subtotal plus the visit's existing adjustment when omitted (a discount survives a service
     * change; it is dropped only if the bill would go below ₹0); the revenue-split snapshot is recomputed with the
     * visit's ORIGINAL rates, as `updateBilling` does. In 'auto' mode the shares are rewritten from the
     * new lines; in 'manual' mode they are left exactly as edited and `sharesOutdated` tells the caller
     * to ask the user to check them. Only rows that actually change are written.
     */
    async updateLines(
      visitId: UUID,
      lines: VisitLineInput[],
      adjustment: { actualBillPaise?: Paise; adjustmentReason?: string | null } = {}
    ): Promise<{ visit: Visit; sharesOutdated: boolean }> {
      const visit = await repos.visits.get(visitId);
      if (!visit) throw new Error(`Visit not found (id: ${visitId})`);
      if (visit.deleted) throw new Error(VISIT_DELETED);
      if (visit.invoiceId) throw new Error(LINES_FROZEN);
      const clinic = await loadClinic(visit.clinicId);

      const [existingItems, existingCredits] = await Promise.all([
        repos.visitItems.listByVisitIds([visitId]),
        repos.visitCredits.listByVisitIds([visitId]),
      ]);
      const catalog = await loadCatalog(specsFromLines(lines));
      const specs = withPackageFlags(specsFromLines(lines), catalog, existingItems);
      await checkSpecs(visit.clinicId, visit.therapistId, specs);

      const now = new Date().toISOString();
      const { live, rows, keptPackage } = reconcileLines(
        visitId,
        visit.clinicId,
        specs,
        catalog,
        existingItems,
        now
      );

      // A package PURCHASE can't be removed while later sessions of it are logged: they'd be orphaned.
      const hadPackage = existingItems.some((i) => i.isPackageLine);
      if (hadPackage && !keptPackage && visit.packageGroupId && visit.sessionIndex === 1) {
        const group = await repos.visits.listByPackageGroup(visit.packageGroupId);
        if (group.some((v) => v.id !== visit.id && !v.deleted)) {
          throw new Error('This package already has later sessions. Remove those first.');
        }
      }

      const catalogPricePaise = live.reduce((sum, l) => sum + l.pricePaise, 0);
      let reason =
        adjustment.adjustmentReason !== undefined ? adjustment.adjustmentReason : visit.adjustmentReason;
      // Without an explicit bill the visit keeps its discount (or surcharge) as the same rupee amount on
      // the new subtotal; only a bill that would go below ₹0 clears it.
      let wantedBill = adjustment.actualBillPaise;
      if (wantedBill === undefined) {
        const carried = catalogPricePaise + visit.adjustmentPaise;
        if (carried >= 0) wantedBill = carried;
        else {
          wantedBill = catalogPricePaise;
          reason = null;
        }
      }
      const { actualBillPaise, adjustmentPaise } = billFor(catalogPricePaise, wantedBill, reason);
      const split = computeVisitSplit(actualBillPaise, visit.clinicSplitPct, visit.taxPct, visit.tdsBasis);

      const pkgSpec = specs.find((s) => s.isPackage);
      let pkg: { sessionIndex: number | null; packageTotal: number | null; packageGroupId: UUID | null };
      if (!pkgSpec) {
        pkg = { sessionIndex: null, packageTotal: null, packageGroupId: null };
      } else if (pkgSpec.continuation) {
        pkg = { ...pkgSpec.continuation };
      } else if (keptPackage && visit.packageGroupId) {
        pkg = {
          sessionIndex: visit.sessionIndex ?? 1,
          packageTotal: visit.packageTotal ?? catalog.get(pkgSpec.serviceCatalogId)!.sessionCount,
          packageGroupId: visit.packageGroupId,
        };
      } else {
        pkg = {
          sessionIndex: 1,
          packageTotal: catalog.get(pkgSpec.serviceCatalogId)!.sessionCount,
          packageGroupId: crypto.randomUUID(),
        };
      }

      const updated: Visit = {
        ...visit,
        serviceCatalogId: live[0].serviceCatalogId,
        catalogPricePaise,
        actualBillPaise,
        adjustmentPaise,
        adjustmentReason: adjustmentPaise !== 0 ? (reason?.trim() ?? null) : null,
        ...pkg,
        ...split,
        updatedAt: now,
      };

      let credits: VisitCredit[] = [];
      let sharesOutdated = false;
      if ((visit.creditsMode ?? 'auto') === 'manual' || isLegacySplit(visit, existingCredits)) {
        // Hand-edited shares (or an old visit's split, which has no share rows) are never rewritten
        // behind the user's back.
        sharesOutdated = true;
      } else {
        const { therapistSplit } = clinicBillingConfig(clinic);
        credits = creditRows(
          updated,
          existingCredits,
          autoCredits(live, updated.therapistId, actualBillPaise, { splitEnabled: therapistSplit }),
          now
        );
      }
      await repos.visits.putWithChildren(updated, rows, credits);
      return { visit: updated, sharesOutdated };
    },

    /**
     * Sets the visit's revenue shares by hand (each row is a therapist's TOTAL share) and switches the
     * visit to 'manual' so line edits stop rewriting them. Allowed on invoiced visits: shares are
     * internal attribution and never touch the billed amount. The shares must add up to the bill exactly,
     * none may be negative, the visit's therapist has a row, everyone belongs to the visit's clinic, and
     * package money stays with whoever holds it — the deliverer of the package line (the primary when
     * the clinic's therapist split is off), whose share can't drop below that line's net.
     */
    async setShares(
      visitId: UUID,
      rows: { therapistId: UUID; amountPaise: Paise }[]
    ): Promise<Visit> {
      const visit = await repos.visits.get(visitId);
      if (!visit) throw new Error(`Visit not found (id: ${visitId})`);
      if (visit.deleted) throw new Error(VISIT_DELETED);
      const clinic = await loadClinic(visit.clinicId);
      const [items, existing] = await Promise.all([
        repos.visitItems.listByVisitIds([visitId]),
        repos.visitCredits.listByVisitIds([visitId]),
      ]);

      if (rows.length === 0) throw new Error(SHARES_DONT_ADD_UP);
      if (new Set(rows.map((r) => r.therapistId)).size !== rows.length) {
        throw new Error('Each therapist can have only one share.');
      }
      await assertInClinic(visit.clinicId, rows.map((r) => r.therapistId));
      if (!rows.some((r) => r.therapistId === visit.therapistId)) {
        throw new Error("The visit's therapist needs a share, even if it's ₹0.");
      }

      const { therapistSplit } = clinicBillingConfig(clinic);
      const locked = packageHolder(visit, items, therapistSplit);
      for (const r of rows) {
        if (!Number.isInteger(r.amountPaise)) throw new Error('Share amounts must be whole paise.');
        if (r.amountPaise < 0) throw new Error(SHARE_BELOW_ZERO);
        if (locked && r.therapistId === locked.therapistId && r.amountPaise < locked.amountPaise) {
          throw new Error(SHARE_BELOW_PACKAGE);
        }
      }
      if (locked && locked.amountPaise > 0 && !rows.some((r) => r.therapistId === locked.therapistId)) {
        throw new Error(SHARE_BELOW_PACKAGE);
      }
      const total = rows.reduce((sum, r) => sum + r.amountPaise, 0);
      if (total > visit.actualBillPaise) throw new Error(SHARE_TOO_LARGE);
      if (total !== visit.actualBillPaise) throw new Error(SHARES_DONT_ADD_UP);

      // Saving the shares confirms them: every live share row is rewritten (even with the same amount) so
      // its updatedAt is later than the newest service line's, which clears the "services changed" prompt
      // (`sharesAreOutdated` compares them with `>`). The stamp is never earlier than a line's, plus 1ms,
      // so identical-millisecond writes can't leave the prompt showing.
      const newestLine = items.reduce((m, l) => Math.max(m, Date.parse(l.updatedAt) || 0), 0);
      const now = new Date(Math.max(Date.now(), newestLine + 1)).toISOString();
      const updated: Visit = { ...visit, creditsMode: 'manual', updatedAt: now };
      const changed = creditRows(updated, existing, rows, now);
      const touched = existing
        .filter((c) => !c.deleted && rows.some((r) => r.therapistId === c.therapistId))
        .filter((c) => !changed.some((w) => w.id === c.id))
        .map((c) => ({ ...c, updatedAt: now }));
      await repos.visits.putWithChildren(updated, [], [...changed, ...touched]);
      return updated;
    },

    /** Puts the visit's shares back to automatic: recomputed from its lines, and kept in step from now on. */
    async recalculateShares(visitId: UUID): Promise<Visit> {
      const visit = await repos.visits.get(visitId);
      if (!visit) throw new Error(`Visit not found (id: ${visitId})`);
      const clinic = await loadClinic(visit.clinicId);
      const [items, existing] = await Promise.all([
        repos.visitItems.listByVisitIds([visitId]),
        repos.visitCredits.listByVisitIds([visitId]),
      ]);
      const now = new Date().toISOString();
      const updated: Visit = { ...visit, creditsMode: 'auto', updatedAt: now };
      const { therapistSplit } = clinicBillingConfig(clinic);
      const shares = autoCredits(items, visit.therapistId, visit.actualBillPaise, {
        splitEnabled: therapistSplit,
      });
      await repos.visits.putWithChildren(updated, [], creditRows(updated, existing, shares, now));
      return updated;
    },

    /**
     * Edits an uninvoiced visit. Splits are recomputed with the visit's
     * ORIGINAL rate snapshots — editing a bill never silently re-rates it.
     * Revenue shares follow a change of bill or primary therapist: 'auto' shares are rewritten (untagged
     * lines follow the new primary by themselves; a line tagged with the new primary has its tag cleared,
     * queued before the visit row as a safety ordering, so no pushed state has an assistant equal to the
     * primary), 'manual' ones keep their amounts and `sharesOutdated` is true; if the new primary has no
     * share row, the old primary's row moves to them, so the primary always has a row.
     */
    async updateBilling(
      visitId: UUID,
      changes: {
        actualBillPaise?: Paise;
        adjustmentReason?: string | null;
        therapistId?: UUID;
        visitDate?: string;
        condition?: string | null;
        treatmentNotes?: string | null;
        treatmentIds?: UUID[];
      }
    ): Promise<Visit & { sharesOutdated: boolean }> {
      const visit = await repos.visits.get(visitId);
      if (!visit) throw new Error(`Visit not found (id: ${visitId})`);
      // "Frozen" means the billed amount and who it's billed to can't move
      // once invoiced -- it does not mean the visit's clinical record is
      // locked. A therapist backfilling condition/treatmentNotes on an
      // already-invoiced visit (the common case: notes get written up a
      // day or two after the session) must still go through.
      const changesBilling =
        changes.actualBillPaise !== undefined ||
        changes.adjustmentReason !== undefined ||
        'therapistId' in changes ||
        'visitDate' in changes;
      if (visit.invoiceId && changesBilling) {
        throw new Error(`This visit is on invoice ${visit.invoiceId}; its billing is frozen.`);
      }

      const actualBillPaise = changes.actualBillPaise ?? visit.actualBillPaise;
      const adjustmentPaise = actualBillPaise - visit.catalogPricePaise;
      const reason =
        changes.adjustmentReason !== undefined ? changes.adjustmentReason : visit.adjustmentReason;
      if (adjustmentPaise !== 0 && !reason?.trim()) {
        throw new Error('An adjustment reason is required when the bill differs from the catalog price');
      }
      const split = computeVisitSplit(
        actualBillPaise,
        visit.clinicSplitPct,
        visit.taxPct,
        visit.tdsBasis
      );

      const updated: Visit = {
        ...visit,
        ...('therapistId' in changes && changes.therapistId ? { therapistId: changes.therapistId } : {}),
        ...('visitDate' in changes && changes.visitDate ? { visitDate: changes.visitDate } : {}),
        ...('condition' in changes ? { condition: changes.condition?.trim() || null } : {}),
        ...('treatmentNotes' in changes
          ? { treatmentNotes: changes.treatmentNotes?.trim() || null }
          : {}),
        ...('treatmentIds' in changes ? { treatmentIds: changes.treatmentIds ?? [] } : {}),
        actualBillPaise,
        adjustmentPaise,
        adjustmentReason: adjustmentPaise !== 0 ? (reason?.trim() ?? null) : null,
        ...split,
        updatedAt: new Date().toISOString(),
      };

      // Shares only move with the bill or the primary; a notes-only edit never reads them.
      const primaryChanged = updated.therapistId !== visit.therapistId;
      const billChanged = actualBillPaise !== visit.actualBillPaise;
      let sharesOutdated = false;
      if (primaryChanged || billChanged) {
        const [items, credits] = await Promise.all([
          repos.visitItems.listByVisitIds([visitId]),
          repos.visitCredits.listByVisitIds([visitId]),
        ]);
        // Old visits with no lines and no share rows stay on the old split path.
        if (items.length > 0 || credits.length > 0) {
          const now = updated.updatedAt;
          const cleared = primaryChanged
            ? items
                .filter((i) => i.assistingTherapistId === updated.therapistId)
                .map((i) => ({ ...i, assistingTherapistId: null, updatedAt: now }))
            : [];
          let creditWrites: VisitCredit[] = [];
          if ((visit.creditsMode ?? 'auto') === 'manual' || isLegacySplit(visit, credits)) {
            sharesOutdated = credits.length > 0 || isLegacySplit(visit, credits);
            // The primary always has a row: if the new primary has none, the old primary's row moves to
            // them (same amount, so the total is unchanged).
            const oldRow = credits.find((c) => c.therapistId === visit.therapistId);
            if (primaryChanged && oldRow && !credits.some((c) => c.therapistId === updated.therapistId)) {
              creditWrites = [{ ...oldRow, therapistId: updated.therapistId, updatedAt: now }];
            }
          } else {
            const clinic = await loadClinic(visit.clinicId);
            const { therapistSplit } = clinicBillingConfig(clinic);
            const lines = items.map((i) => cleared.find((c) => c.id === i.id) ?? i);
            creditWrites = creditRows(
              updated,
              credits,
              autoCredits(lines, updated.therapistId, actualBillPaise, { splitEnabled: therapistSplit }),
              now
            );
          }
          await repos.visits.putWithChildren(updated, cleared, creditWrites, {
            itemsFirst: cleared.length > 0,
          });
          return { ...updated, sharesOutdated };
        }
      }
      await repos.visits.put(updated);
      return { ...updated, sharesOutdated };
    },

    /**
     * Set (or clear) the internal therapist split on a visit. Unlike
     * updateBilling this is allowed on invoiced visits: it never touches the
     * billed amount or primary therapist, only the reporting-side attribution
     * the hospital doesn't reconcile against. Pass sharedTherapistId: null to
     * clear the split.
     * Still writes the old shared_* columns (reports read them for visits with no share rows) AND now the
     * visit's share rows: assistant = bill x pct rounded to the rupee, primary = the remainder, mode
     * 'manual'. From then on the visit is reported from its share rows.
     */
    async setSplit(
      visitId: UUID,
      split: { sharedTherapistId: UUID | null; sharedPct?: number | null }
    ): Promise<Visit> {
      const visit = await repos.visits.get(visitId);
      if (!visit) throw new Error(`Visit not found (id: ${visitId})`);

      let sharedTherapistId: UUID | null = null;
      let sharedPct: number | null = null;
      if (split.sharedTherapistId) {
        if (visit.actualBillPaise <= 0) {
          throw new Error('This visit has no billed amount to share.');
        }
        if (split.sharedTherapistId === visit.therapistId) {
          throw new Error('Pick a different therapist to share with.');
        }
        const pct = split.sharedPct ?? 0;
        // Enhanced validation: check for NaN, Infinity, and edge cases
        if (
          typeof pct !== 'number' ||
          !Number.isFinite(pct) ||
          !(pct > 0 && pct < 100)
        ) {
          throw new Error(
            `Share percentage must be a finite number between 0 and 100 (exclusive), got: ${pct}`
          );
        }
        sharedTherapistId = split.sharedTherapistId;
        sharedPct = pct;
      }

      const now = new Date().toISOString();
      const updated: Visit = { ...visit, sharedTherapistId, sharedPct, updatedAt: now };
      const existing = await repos.visitCredits.listByVisitIds([visitId]);
      let shares: CreditShare[] | null = null;
      if (sharedTherapistId && sharedPct) {
        await assertInClinic(visit.clinicId, [sharedTherapistId]);
        const assistant = roundToRupeeHalfUp((visit.actualBillPaise * sharedPct) / 100);
        shares = [
          { therapistId: visit.therapistId, amountPaise: visit.actualBillPaise - assistant },
          { therapistId: sharedTherapistId, amountPaise: assistant },
        ];
      } else if (existing.length > 0) {
        // Clearing the split hands the visit back to automatic shares, computed from its lines.
        const clinic = await loadClinic(visit.clinicId);
        const items = await repos.visitItems.listByVisitIds([visitId]);
        shares = autoCredits(items, visit.therapistId, visit.actualBillPaise, {
          splitEnabled: clinicBillingConfig(clinic).therapistSplit,
        });
      }
      if (!shares) {
        await repos.visits.put(updated);
        return updated;
      }
      updated.creditsMode = sharedTherapistId ? 'manual' : 'auto';
      await repos.visits.putWithChildren(updated, [], creditRows(updated, existing, shares, now));
      return updated;
    },

    /**
     * Re-snapshots the clinic/partner split (clinicSplitPct, taxPct, tdsBasis)
     * onto every not-yet-invoiced visit, using the clinic's CURRENT settings.
     * updateBilling deliberately keeps a visit's original rate snapshot on
     * edit (see its test) — that's correct for a visit whose rates were
     * already locked in, but it also means a Settings change to the split %
     * never reaches visits logged before the change. This gives Settings an
     * explicit, bounded way to catch those up: invoiced visits are skipped
     * (their billing is already frozen), and a visit already matching the
     * current rates is left untouched.
     */
    async recomputeUninvoicedSplits(clinicId: UUID): Promise<{ updated: number }> {
      const clinic = await repos.clinics.get(clinicId);
      if (!clinic) throw new Error(`Clinic not found (id: ${clinicId})`);
      const { partnerSplit } = clinicBillingConfig(clinic);
      const splitPct = partnerSplit ? clinic.clinicSplitPct : 100;
      const taxPct = partnerSplit ? clinic.taxPct : 0;
      const tdsBasis = partnerSplit ? clinic.tdsBasis : 'gross_bill';

      const visits = await repos.visits.list({ clinicId });
      let updated = 0;
      for (const v of visits) {
        if (v.invoiceId) continue;
        if (v.clinicSplitPct === splitPct && v.taxPct === taxPct && v.tdsBasis === tdsBasis) continue;
        const split = computeVisitSplit(v.actualBillPaise, splitPct, taxPct, tdsBasis);
        await repos.visits.put({
          ...v,
          clinicSplitPct: splitPct,
          taxPct,
          tdsBasis,
          ...split,
          updatedAt: new Date().toISOString(),
        });
        updated++;
      }
      return { updated };
    },
  };
}
