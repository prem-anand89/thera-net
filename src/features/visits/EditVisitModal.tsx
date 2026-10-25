import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, visitService, dashboardService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { useSession } from '@/app/useSession';
import { formatINR } from '@/domain/money';
import { RevenueShareEditorLoader } from '@/components/RevenueShareEditorLoader';
import {
  ServiceRows,
  continuationLine,
  rowPricePaise,
  rowProblems,
  type DraftLine,
  type OpenPackage,
} from './ServiceRows';
import { adjustmentSurvives, draftLinesToVisitLines } from './draftVisit';
import { toFriendlyMessage } from '@/lib/errors';
import { formatDateDM, monthName } from '@/domain/fiscalYear';
import { visitDateHint } from './visitDateHint';
import { toLocalDateStr } from '@/domain/schedule';
import { rankTreatmentsByUsage } from '@/domain/treatmentUsage';
import {
  clinicBillingConfig,
  type CatalogItem,
  type TreatmentItem,
  type UUID,
  type Visit,
  type VisitItem,
} from '@/domain/types';
import type { TreatmentUsageRow } from '@/services/dashboardService';
import { Field, inputCls, btnPrimary, btnSecondary, MultiToggle, ErrorNote } from '@/components/ui';
import { askConfirm } from '@/lib/notify';
import { useDialogBehavior } from '@/components/dialogBehavior';
import { visitPermissions } from './visitPermissions';
import { confirmAndDeleteVisit } from './confirmDeleteVisit';
import {
  BillAdjustmentFields,
  billAdjustmentFromFields,
} from '@/components/BillAdjustmentFields';
import {
  inferBillAdjustment,
  computeAdjustedBillPaise,
  type BillAdjustmentMode,
  type BillAdjustmentValueType,
} from '@/domain/billAdjustment';

// Stable references for useLiveQuery's loading-state fallback — a fresh
// `?? []` literal on every render would change identity each time and
// defeat the useMemo that ranks treatments by usage.
const EMPTY_TREATMENTS: TreatmentItem[] = [];
const EMPTY_TREATMENT_USAGE: TreatmentUsageRow[] = [];

const EMPTY_ITEMS: VisitItem[] = [];
const EMPTY_CATALOG: CatalogItem[] = [];

function shareOf(it: VisitItem): DraftLine['sessionShare'] {
  return it.sessionShareTherapistId && it.sessionSharePct
    ? { therapistId: it.sessionShareTherapistId, pct: it.sessionSharePct }
    : null;
}

/** The visit's saved services as editable rows; a package session becomes a continuation row. */
function rowsFromItems(visit: Visit, items: VisitItem[], catalog: CatalogItem[]): DraftLine[] {
  return items.map((it) => {
    const isSession = it.isPackageLine && it.pricePaise === 0 && Boolean(visit.packageGroupId) && (visit.sessionIndex ?? 1) > 1;
    if (isSession) {
      return {
        ...continuationLine(ownPackage(visit, it, catalog), it.assistingTherapistId),
        key: it.id,
        sessionShare: shareOf(it),
      };
    }
    return {
      key: it.id,
      serviceCatalogId: it.serviceCatalogId,
      assistingTherapistId: it.assistingTherapistId,
      sessionShare: shareOf(it),
    };
  });
}

/** The package this visit is a session of, as the row picker expects it (so the same session is re-saved). */
function ownPackage(visit: Visit, it: VisitItem, catalog: CatalogItem[]): OpenPackage {
  return {
    packageGroupId: visit.packageGroupId!,
    serviceCatalogId: it.serviceCatalogId,
    serviceName: catalog.find((c) => c.id === it.serviceCatalogId)?.name ?? it.serviceName,
    logged: (visit.sessionIndex ?? 1) - 1,
    packageTotal: visit.packageTotal ?? 1,
    startedOn: '',
  };
}

/** Edits a visit: its services and bill, therapist and date, clinical notes, and how its revenue is
 *  shared. If the visit is invoiced, its services and bill are frozen (read-only); the clinical notes and
 *  the revenue share stay editable. A visit saved before services were tracked has no service rows and
 *  keeps the single-bill editor. */
export function EditVisitModal({
  visitId,
  onClose,
  setError,
}: {
  visitId: UUID;
  onClose: () => void;
  setError: (e: string | null) => void;
}) {
  const clinic = useClinic();
  const permissions = usePermissions();
  const { session } = useSession();

  const visit = useLiveQuery(() => repos.visits.get(visitId), [visitId]);
  const therapists = useLiveQuery(
    () => (visit ? repos.therapists.list(visit.clinicId) : undefined),
    [visit?.clinicId]
  );
  const therapistsAll = useLiveQuery(
    () => (visit ? repos.therapists.list(visit.clinicId, true) : undefined),
    [visit?.clinicId]
  );
  const invoice = useLiveQuery(
    () => (visit?.invoiceId ? repos.invoices.get(visit.invoiceId) : undefined),
    [visit?.invoiceId]
  );
  const patient = useLiveQuery(
    () => (visit ? repos.patients.get(visit.patientId) : undefined),
    [visit?.patientId]
  );
  const catalogItem = useLiveQuery(
    () => (visit ? repos.catalog.get(visit.serviceCatalogId) : undefined),
    [visit?.serviceCatalogId]
  );
  const catalogAll = useLiveQuery(
    () => (visit ? repos.catalog.list(visit.clinicId, true) : undefined),
    [visit?.clinicId]
  );
  const itemsRaw = useLiveQuery(() => repos.visitItems.listByVisitIds([visitId]), [visitId]);
  const payments = useLiveQuery(() => repos.payments.listByVisit(visitId), [visitId]);
  const credits = useLiveQuery(() => repos.visitCredits.listByVisitIds([visitId]), [visitId]);
  const treatments = useLiveQuery(
    () => (visit ? repos.treatmentCatalog.list(visit.clinicId) : undefined),
    [visit?.clinicId]
  ) ?? EMPTY_TREATMENTS;
  const treatmentUsage =
    useLiveQuery(
      () => (visit ? dashboardService.treatmentUsageCounts(visit.clinicId) : undefined),
      [visit?.clinicId]
    ) ?? EMPTY_TREATMENT_USAGE;
  const rankedTreatments = useMemo(
    () => rankTreatmentsByUsage(treatments, treatmentUsage),
    [treatments, treatmentUsage]
  );

  const items = useMemo(
    () => (itemsRaw ?? EMPTY_ITEMS).filter((i) => !i.deleted).sort((a, b) => a.position - b.position),
    [itemsRaw]
  );
  // Active services are offered in the picker; an inactive one is kept only while a saved row uses it.
  const catalog = useMemo(
    () =>
      (catalogAll ?? EMPTY_CATALOG).filter(
        (c) => c.active || items.some((i) => i.serviceCatalogId === c.id)
      ),
    [catalogAll, items]
  );

  const [therapistId, setTherapistId] = useState('');
  const [visitDate, setVisitDate] = useState('');
  const [condition, setCondition] = useState('');
  const [treatmentNotes, setTreatmentNotes] = useState('');
  const [treatmentIds, setTreatmentIds] = useState<string[]>([]);
  const [rows, setRows] = useState<DraftLine[]>([]);
  const [rowErrors, setRowErrors] = useState<Map<number, string>>(new Map());
  const [adjustmentMode, setAdjustmentMode] = useState<BillAdjustmentMode>('none');
  const [adjustmentValueType, setAdjustmentValueType] = useState<BillAdjustmentValueType>('amount');
  const [adjustmentValue, setAdjustmentValue] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setErrorState] = useState<string | null>(null);
  const [sharesFor, setSharesFor] = useState<Visit | null>(null);
  // True when the share editor was opened by the save itself (shares fell behind), which ends the edit.
  const [sharesEndEdit, setSharesEndEdit] = useState(false);
  const initialSigRef = useRef<string | null>(null);

  const signature = (list: DraftLine[]) =>
    list
      .map(
        (r) =>
          `${r.key}|${r.continuation?.serviceCatalogId ?? r.serviceCatalogId}|${r.assistingTherapistId ?? ''}|${r.sessionShare ? `${r.sessionShare.therapistId}:${r.sessionShare.pct}` : ''}`
      )
      .join(',');

  useEffect(() => {
    if (!visit || loaded || itemsRaw === undefined || catalogAll === undefined) return;
    setTherapistId(visit.therapistId);
    setVisitDate(visit.visitDate);
    setCondition(visit.condition ?? '');
    setTreatmentNotes(visit.treatmentNotes ?? '');
    setTreatmentIds(visit.treatmentIds ?? []);
    const initialRows = rowsFromItems(visit, items, catalogAll);
    setRows(initialRows);
    const inferred = inferBillAdjustment(visit.catalogPricePaise, visit.actualBillPaise);
    setAdjustmentMode(inferred.mode);
    setAdjustmentValueType(inferred.valueType);
    setAdjustmentValue(inferred.value > 0 ? String(inferred.value) : '');
    setAdjustmentReason(visit.adjustmentReason ?? '');
    initialSigRef.current = [
      visit.therapistId,
      visit.visitDate,
      (visit.condition ?? '').trim(),
      (visit.treatmentNotes ?? '').trim(),
      [...(visit.treatmentIds ?? [])].sort().join(','),
      signature(initialRows),
      inferred.mode,
      inferred.valueType,
      inferred.value > 0 ? String(inferred.value) : '',
      (visit.adjustmentReason ?? '').trim(),
    ].join('::');
    setLoaded(true);
  }, [visit, loaded, itemsRaw, catalogAll, items]);

  const currentSig = useMemo(
    () =>
      [
        therapistId,
        visitDate,
        condition.trim(),
        treatmentNotes.trim(),
        [...treatmentIds].sort().join(','),
        signature(rows),
        adjustmentMode,
        adjustmentValueType,
        adjustmentValue,
        adjustmentReason.trim(),
      ].join('::'),
    [
      therapistId,
      visitDate,
      condition,
      treatmentNotes,
      treatmentIds,
      rows,
      adjustmentMode,
      adjustmentValueType,
      adjustmentValue,
      adjustmentReason,
    ]
  );
  const isDirty = loaded && initialSigRef.current !== null && initialSigRef.current !== currentSig;

  async function requestClose() {
    if (isDirty) {
      const discard = await askConfirm({
        title: 'Discard unsaved changes?',
        message: 'Your edits to this visit will be lost.',
        confirmLabel: 'Discard',
        destructive: true,
      });
      if (!discard) return;
    }
    onClose();
  }

  const dialogRef = useDialogBehavior<HTMLDivElement>(true, () => void requestClose(), () => !busy);

  if (!visit) return null;

  const frozen = visit.invoiceId !== null;
  const hasLines = items.length > 0;
  const activeTherapists = (therapists ?? []).filter((t) => t.active);
  const showAssistant = clinic.clinicType !== 'individual' && activeTherapists.length > 1;
  const canEditShares =
    clinicBillingConfig(clinic).therapistSplit && activeTherapists.length > 1 && visit.actualBillPaise > 0;
  const ownPackages: OpenPackage[] = items
    .filter((i) => i.isPackageLine && i.pricePaise === 0 && visit.packageGroupId && (visit.sessionIndex ?? 1) > 1)
    .map((i) => ownPackage(visit, i, catalogAll ?? []));

  // Permissions & Delete
  const myTherapistId = (therapistsAll ?? therapists ?? []).find((t) => t.userId === session?.user?.id)?.id;
  const perms = visitPermissions({
    isAdmin: permissions.isAdmin,
    isFrontDesk: permissions.role === 'front_desk',
    myTherapistId,
    visitTherapistId: visit.therapistId,
    invoiced: Boolean(visit.invoiceId),
  });

  // A saved row keeps the price it was saved at; a new or changed row takes today's catalog price.
  const rowPrice = (r: DraftLine) => {
    const saved = items.find((i) => i.id === r.key);
    return saved && !r.continuation && saved.serviceCatalogId === r.serviceCatalogId
      ? saved.pricePaise
      : rowPricePaise(r, catalog);
  };
  const subtotalPaise = hasLines && !frozen ? rows.reduce((sum, r) => sum + rowPrice(r), 0) : visit.catalogPricePaise;
  const billPaise = computeAdjustedBillPaise(
    subtotalPaise,
    billAdjustmentFromFields(adjustmentMode, adjustmentValueType, adjustmentValue)
  );
  const adjustmentPaise = billPaise - subtotalPaise;

  const paidPaise = (payments ?? []).reduce((sum, p) => sum + p.amountPaise, 0);
  const paymentDelta = billPaise - paidPaise;

  // Month shift check
  const originalMonth = visit.visitDate ? visit.visitDate.slice(0, 7) : '';
  const newMonth = visitDate ? visitDate.slice(0, 7) : '';
  const monthShifted = Boolean(visitDate && originalMonth && originalMonth !== newMonth);
  const newMonthNum = newMonth ? parseInt(newMonth.slice(5, 7), 10) : 0;
  const dateHint = visitDate ? visitDateHint(visitDate, toLocalDateStr(new Date())) : null;

  // Therapist reassignment side effect check
  const therapistWasAssisting = Boolean(
    therapistId &&
    therapistId !== visit.therapistId &&
    items.some((i) => i.assistingTherapistId === therapistId)
  );

  function resetBillAdjustment() {
    setAdjustmentMode('none');
    setAdjustmentValueType('amount');
    setAdjustmentValue('');
    setAdjustmentReason('');
  }

  /** Row edits keep the discount; it is dropped only when a ₹ discount no longer fits the new subtotal. */
  function changeRows(next: DraftLine[]) {
    setRows(next);
    setRowErrors(new Map());
    const subtotal = next.reduce((sum, r) => sum + rowPrice(r), 0);
    if (!adjustmentSurvives(subtotal, adjustmentMode, adjustmentValueType, adjustmentValue)) resetBillAdjustment();
  }

  function changeTherapist(id: string) {
    setTherapistId(id);
    // An assistant can't also be the visit's therapist.
    setRows((prev) =>
      prev.map((r) => {
        const next = r.assistingTherapistId === id ? { ...r, assistingTherapistId: null } : r;
        return next.sessionShare && next.sessionShare.therapistId === (next.assistingTherapistId ?? id)
          ? { ...next, sessionShare: null }
          : next;
      })
    );
  }

  const rowsChanged =
    signature(rows) !== signature(rowsFromItems(visit, items, catalogAll ?? [])) ||
    billPaise !== visit.actualBillPaise;

  async function submit() {
    if (!visit) return;
    setBusy(true);
    setErrorState(null);
    try {
      // Re-read the visit before the first write: it may have been invoiced or deleted since this
      // editor opened (another device, front desk), and a stale edit must not go half through.
      const current = await repos.visits.get(visitId);
      if (!current || current.deleted) throw new Error('This visit was deleted.');
      if (frozen || current.invoiceId) {
        if (!frozen) throw new Error("This visit was invoiced while you were editing. Close and reopen it.");
        await visitService.updateBilling(visitId, {
          condition: condition.trim() || null,
          treatmentNotes: treatmentNotes.trim() || null,
          treatmentIds,
        });
        onClose();
        return;
      }
      if (adjustmentPaise !== 0 && !adjustmentReason.trim()) {
        throw new Error('Add a reason for the discount or extra.');
      }
      let outdated = false;
      const details = {
        condition: condition.trim() || null,
        treatmentNotes: treatmentNotes.trim() || null,
        treatmentIds,
      };
      if (hasLines) {
        if (rowProblems(rows, catalog).size > 0) throw new Error('Check the service marked in red.');
        const built = draftLinesToVisitLines(rows, ownPackages);
        if ('errors' in built) {
          setRowErrors(built.errors);
          throw new Error('Check the service marked in red.');
        }
        const writeLines = async () => {
          const res = await visitService.updateLines(visitId, built.lines, {
            actualBillPaise: billPaise,
            adjustmentReason: adjustmentPaise !== 0 ? adjustmentReason.trim() : null,
          });
          outdated = outdated || res.sharesOutdated;
        };
        const therapistMoved = therapistId !== current.therapistId;
        if (rowsChanged && !therapistMoved) await writeLines();
        const moved = await visitService.updateBilling(visitId, { therapistId, visitDate, ...details });
        outdated = outdated || moved.sharesOutdated;
        if (rowsChanged && therapistMoved) await writeLines();
      } else {
        const res = await visitService.updateBilling(visitId, {
          actualBillPaise: billPaise,
          adjustmentReason: adjustmentPaise !== 0 ? adjustmentReason.trim() : null,
          therapistId,
          visitDate,
          ...details,
        });
        outdated = res.sharesOutdated;
      }
      if (outdated && canEditShares) {
        const fresh = await repos.visits.get(visitId);
        if (fresh) {
          setSharesEndEdit(true);
          setSharesFor(fresh);
          return;
        }
      }
      onClose();
    } catch (e) {
      const friendly = toFriendlyMessage(e);
      setErrorState(friendly);
      setError(friendly);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!visit) return;
    await confirmAndDeleteVisit(visit.id);
    const fresh = await repos.visits.get(visit.id);
    if (!fresh || fresh.deleted) {
      onClose();
    }
  }

  const nameOf = (id: string) => (therapistsAll ?? therapists ?? []).find((t) => t.id === id)?.name ?? 'Therapist';
  const liveCredits = (credits ?? []).filter((c) => !c.deleted);
  const lastEditorName = visit.updatedBy
    ? (therapistsAll ?? therapists ?? []).find((t) => t.userId === visit.updatedBy)?.name
    : undefined;

  // Reusable Clinical Notes section
  const clinicalNotesSection = (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
        Clinical Notes
      </h3>

      <Field label="Condition">
        <input
          className={inputCls}
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          placeholder="e.g., Cervical pain"
        />
      </Field>

      <Field label="Treatments">
        <div className="space-y-2">
          {rankedTreatments.frequent.length > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium text-[var(--muted)]">Frequently used</p>
              <MultiToggle
                options={rankedTreatments.frequent.map((t) => ({ value: t.id, label: t.name }))}
                value={treatmentIds}
                onChange={setTreatmentIds}
              />
            </div>
          )}
          {rankedTreatments.rest.length > 0 && (
            <div className="space-y-1">
              {rankedTreatments.frequent.length > 0 && (
                <p className="text-[11px] font-medium text-[var(--muted)]">All treatments</p>
              )}
              <MultiToggle
                options={rankedTreatments.rest.map((t) => ({ value: t.id, label: t.name }))}
                value={treatmentIds}
                onChange={setTreatmentIds}
              />
            </div>
          )}
          <textarea
            className={`${inputCls} min-h-20 resize-none`}
            value={treatmentNotes}
            onChange={(e) => setTreatmentNotes(e.target.value)}
            placeholder="Anything not in the list…"
          />
        </div>
      </Field>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) void requestClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-visit-title"
        className="modal-shell w-full sm:max-w-xl h-full sm:h-auto sm:max-h-[90vh] flex flex-col rounded-none sm:rounded-2xl"
      >
        <div className="modal-header shrink-0 flex items-center justify-between border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <div>
            <h2 id="edit-visit-title" className="text-base font-semibold text-[var(--ink)]">
              Edit visit
            </h2>
            <p className="text-xs text-[var(--muted)]">
              {patient?.name ?? '—'}{patient?.mrno ? ` · Patient ID ${patient.mrno}` : ''}
            </p>
          </div>
          <button
            className="modal-close"
            onClick={() => void requestClose()}
            aria-label="Close"
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="modal-body space-y-4 overflow-y-auto p-4 sm:p-5 flex-1">
          {frozen && (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--paper)] p-3 text-xs text-[var(--ink)]">
              <p className="font-semibold text-[var(--teal)]">Locked on Invoice #{invoice?.invoiceNo ?? '—'}</p>
              <p className="mt-0.5 text-[var(--muted)]">
                Services and billing are locked. Condition and treatment notes can still be updated.
              </p>
            </div>
          )}

          {/* When invoiced: Clinical notes come FIRST */}
          {frozen && clinicalNotesSection}

          {/* When invoiced: Services & Bill are rendered read-only */}
          {hasLines && frozen && (
            <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4" aria-label="Services">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                Services & Bill (Locked)
              </h3>
              <ul className="space-y-1.5 text-sm text-[var(--ink)]">
                {items.map((i) => (
                  <li key={i.id} className="flex justify-between gap-2">
                    <span>
                      {i.serviceName}
                      {i.assistingTherapistId && (
                        <span className="text-xs text-[var(--muted)]"> · done by {nameOf(i.assistingTherapistId)}</span>
                      )}
                      {i.sessionShareTherapistId && i.sessionSharePct ? (
                        <span className="text-xs text-[var(--muted)]"> · shared with {nameOf(i.sessionShareTherapistId)} ({i.sessionSharePct}%)</span>
                      ) : null}
                    </span>
                    <span className="font-num font-medium">{formatINR(i.pricePaise)}</span>
                  </li>
                ))}
              </ul>
              <div className="border-t border-[var(--border)] pt-2 flex justify-between text-sm font-semibold text-[var(--ink)]">
                <span>Total Billed</span>
                <span className="font-num">{formatINR(visit.actualBillPaise)}</span>
              </div>
            </div>
          )}

          {/* When uninvoiced: When & Who, Services & Bill, then Clinical Notes */}
          {!frozen && (
            <>
              {/* When & Who */}
              <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  When & Who
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Field label="Visit date">
                      <input
                        type="date"
                        className={inputCls}
                        value={visitDate}
                        onChange={(e) => setVisitDate(e.target.value)}
                      />
                    </Field>
                    {monthShifted ? (
                      <p className="mt-1 text-xs text-[var(--rust)]">
                        This moves the visit into {monthName(newMonthNum)}'s report.
                      </p>
                    ) : dateHint ? (
                      <p className={dateHint.tone === 'warn' ? 'mt-1 text-xs text-[var(--rust)]' : 'mt-1 text-xs text-[var(--muted)]'}>
                        {dateHint.text}
                      </p>
                    ) : null}
                  </div>

                  <div>
                    <Field label="Therapist">
                      <select
                        className={inputCls}
                        value={therapistId}
                        onChange={(e) => changeTherapist(e.target.value)}
                      >
                        <option value="">Select a therapist</option>
                        {(therapists ?? []).map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {therapistWasAssisting && (
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {nameOf(therapistId)} was assisting; that service will go back to the visit therapist.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* Services & Billing */}
              <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)]">
                  Services & Bill
                </h3>

                {hasLines && (
                  <ServiceRows
                    rows={rows}
                    onChange={changeRows}
                    catalog={catalog}
                    openPackages={ownPackages}
                    therapists={therapists ?? []}
                    primaryId={therapistId || visit.therapistId}
                    showAssistant={showAssistant}
                    errors={rowErrors}
                    patientName={patient?.name}
                  />
                )}

                {/* Payment status badge / line */}
                <div className="rounded-lg bg-[var(--paper)] px-3 py-2 text-xs text-[var(--ink)] flex items-center justify-between">
                  <span className="font-medium text-[var(--muted)]">Payment status</span>
                  {paidPaise > 0 ? (
                    paymentDelta === 0 ? (
                      <span className="font-medium text-[var(--teal)]">Paid {formatINR(paidPaise)} · Settled</span>
                    ) : paymentDelta > 0 ? (
                      <span className="font-medium text-[var(--rust)]">Paid {formatINR(paidPaise)} · {formatINR(paymentDelta)} more to collect</span>
                    ) : (
                      <span className="font-medium text-[var(--teal)]">Paid {formatINR(paidPaise)} · {formatINR(Math.abs(paymentDelta))} overpaid</span>
                    )
                  ) : billPaise === 0 ? (
                    <span className="text-[var(--muted)]">No charge · ₹0</span>
                  ) : (
                    <span className="font-medium text-[var(--rust)]">Payment due · {formatINR(billPaise)}</span>
                  )}
                </div>

                <BillAdjustmentFields
                  catalogPricePaise={subtotalPaise}
                  catalogLabel={
                    hasLines ? 'Subtotal' : catalogItem ? `Catalog — ${catalogItem.name}` : 'Catalog price'
                  }
                  totalLabel={hasLines ? 'Total' : undefined}
                  hideUnadjustedPrice={hasLines}
                  disabled={hasLines && subtotalPaise === 0}
                  mode={adjustmentMode}
                  valueType={adjustmentValueType}
                  value={adjustmentValue}
                  reason={adjustmentReason}
                  onModeChange={setAdjustmentMode}
                  onValueTypeChange={setAdjustmentValueType}
                  onValueChange={setAdjustmentValue}
                  onReasonChange={setAdjustmentReason}
                  continuationSession={subtotalPaise === 0}
                />
              </div>

              {/* Clinical Notes */}
              {clinicalNotesSection}
            </>
          )}

          {canEditShares && (
            <div className="space-y-0.5 text-xs text-[var(--muted)]">
              <p>
                <span className="font-medium">Revenue share</span>
                {liveCredits.length > 0 && (
                  <>
                    {' '}
                    —{' '}
                    {liveCredits.map((c) => `${nameOf(c.therapistId)} ${formatINR(c.amountPaise)}`).join(' · ')}
                  </>
                )}{' '}
                <button
                  type="button"
                  className="font-medium text-[var(--teal)] hover:underline"
                  onClick={() => setSharesFor(visit)}
                >
                  Edit split
                </button>
              </p>
              {frozen && <p>Does not change the patient's bill.</p>}
            </div>
          )}

          {/* Last edited attribution */}
          {visit.updatedAt && (
            <p className="text-xs text-[var(--muted)]">
              Last updated{lastEditorName ? ` by ${lastEditorName}` : ''}, {formatDateDM(visit.updatedAt)}
            </p>
          )}

          {/* In-dialog error note */}
          {error && (
            <div className="pt-1">
              <ErrorNote message={error} />
            </div>
          )}

          {/* Quiet delete visit link (only if user has delete permissions) */}
          {perms.canDelete && (
            <div className="pt-3 border-t border-[var(--border)] text-center">
              <button
                type="button"
                className="text-xs font-medium text-[var(--rust)] hover:underline"
                onClick={() => void handleDelete()}
                disabled={busy}
              >
                Delete this visit
              </button>
            </div>
          )}
        </div>

        {/* Sticky footer with bill/payment summary and actions */}
        <div className="modal-actions shrink-0 flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 bg-[var(--surface)]">
          <div className="text-xs">
            <span className="font-semibold text-sm text-[var(--ink)]">{formatINR(billPaise)}</span>
            <span className="text-[var(--muted)] ml-1.5">
              {paidPaise > 0 ? `· Paid ${formatINR(paidPaise)}` : billPaise > 0 ? '· Unpaid' : ''}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              className={btnSecondary}
              onClick={() => void requestClose()}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className={btnPrimary}
              onClick={submit}
              disabled={busy || (!frozen && (!therapistId || !visitDate))}
            >
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>

      {sharesFor && (
        <RevenueShareEditorLoader
          visit={sharesFor}
          therapists={therapistsAll ?? therapists ?? []}
          onClose={() => {
            setSharesFor(null);
            if (sharesEndEdit) onClose();
          }}
        />
      )}
    </div>
  );
}
