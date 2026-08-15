import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, visitService, patientService, directPaymentService, dashboardService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useSession } from '@/app/useSession';
import { usePermissions } from '@/app/usePermissions';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import { DUPLICATE_NAME_THRESHOLD, nameSimilarity } from '@/domain/nameSimilarity';
import {
  effectivePricePerSession,
  referringSourceDetailLabel,
  REFERRING_SOURCE_LABELS,
  type Patient,
  type PaymentMethod,
  type ReferringSource,
  type UUID,
} from '@/domain/types';
import { toFriendlyMessage } from '@/lib/errors';
import {
  Field,
  inputCls,
  btnPrimary,
  btnSecondary,
  ErrorNote,
  RupeeInput,
  SectionCard,
  Pill,
  PackageThread,
} from '@/components/ui';
import { EditPatientModal } from '@/features/patients/EditPatientModal';
import { PAYMENT_CHIP } from '@/components/VisitCard';
import { computeVisitPaymentState } from '@/domain/paymentState';

/** Digits only, so "98765 43210" and "+91-98765-43210" compare equal. */
function phoneDigits(s: string): string {
  return s.replace(/\D/g, '');
}

interface OpenPackage {
  packageGroupId: UUID;
  serviceCatalogId: UUID;
  serviceName: string;
  logged: number;
  packageTotal: number;
  startedOn: string;
}

const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
  { value: 'bank_transfer', label: 'Bank transfer' },
  { value: 'cheque', label: 'Cheque' },
];

/** Compact reference card for the patient side panel — last visit / open
 *  package are more decision-relevant here than an outstanding-balance
 *  figure (that's a billing/collections concern, already surfaced on the
 *  Ledger table and Patient Profile). */
function SummaryTile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-1 text-sm text-[var(--ink)]">{children}</div>
    </div>
  );
}

/** Two/three-way pill toggle — replaces a radio-button row where the choice
 *  is really "pick one of these modes", not a form field in the accessible-
 *  radio-group sense. */
function SegmentedToggle<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-md border border-[var(--border)] p-0.5 text-sm">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={opt.disabled}
          onClick={() => onChange(opt.value)}
          className={`flex-1 rounded px-3 py-1.5 text-center font-medium transition-colors ${
            value === opt.value
              ? 'bg-[var(--teal-light)] text-[var(--teal)]'
              : 'text-[var(--muted)] hover:bg-[var(--paper)]'
          } ${opt.disabled ? 'cursor-not-allowed opacity-50' : ''}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function NewVisitPage() {
  const clinic = useClinic();
  const { canBill } = usePermissions();
  const navigate = useNavigate();
  const { session } = useSession();
  const search = useSearch({ strict: false }) as {
    repeatVisitId?: string;
    patientId?: string;
    prefillName?: string;
  };

  // Patient selection — a small state machine: searching (default) → either
  // creating (no existing patient matched) or confirmed (patient is set).
  // Only one of these three views renders at a time, so the create-patient
  // fields are never visible alongside a confirmed patient's summary.
  const [query, setQuery] = useState('');
  const [patient, setPatient] = useState<Patient | null>(null);
  const [creatingPatient, setCreatingPatient] = useState(false);
  const [editingPatient, setEditingPatient] = useState(false);
  const [newPatient, setNewPatient] = useState({
    name: search.prefillName ?? '',
    mrno: '',
    age: '',
    sex: '',
    phone: '',
    primaryCondition: '',
    referringSource: '' as ReferringSource | '',
    referringSourceDetail: '',
  });

  // Visit fields
  const today = new Date().toISOString().slice(0, 10);
  const [visitDate, setVisitDate] = useState(today);
  const [therapistId, setTherapistId] = useState('');
  const [mode, setMode] = useState<'new' | 'continuation'>('new');
  const [serviceCatalogId, setServiceCatalogId] = useState('');
  const [openPackageId, setOpenPackageId] = useState('');
  const [billOverride, setBillOverride] = useState<number | null>(null);
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [paymentChoice, setPaymentChoice] = useState<'paid' | 'pending'>('paid');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [pendingNote, setPendingNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set only when the clinic has clinical docs on — swaps the form for a
  // one-time "add a note now?" offer at the highest-intent moment, right
  // after saving while the therapist is still on the page. Clinics that
  // haven't opted in see no change: save still navigates straight to
  // Workspace.
  const [justSaved, setJustSaved] = useState<{ visitId: UUID; patientId: UUID; patientName: string } | null>(null);

  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id), [clinic.id]);
  const myTherapistId = useMemo(
    () => (therapists ?? []).find((t) => t.userId === session?.user?.id)?.id,
    [therapists, session?.user?.id]
  );
  const catalog = useLiveQuery(() => repos.catalog.list(clinic.id), [clinic.id]);
  const matches = useLiveQuery(
    () => (patient ? Promise.resolve([]) : repos.patients.search(clinic.id, query)),
    [clinic.id, query, patient]
  );
  const allPatients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);

  // Live near-miss check as the create-patient form is filled in (MRNO stays
  // the true identifier) — surfaces before submit so a typo'd name or a
  // phone number already on file is caught while the receptionist is still
  // looking at the field, not after. Phone is an exact match (a shared
  // phone is a much stronger duplicate signal than a fuzzy name), and wins
  // over a name near-miss when both are present.
  const duplicateMatch = useMemo(() => {
    const typed = newPatient.name.trim();
    const typedPhoneDigits = phoneDigits(newPatient.phone);
    if (!typed && typedPhoneDigits.length < 3) return null;
    const active = (allPatients ?? []).filter((p) => !p.deletedAt);

    if (typedPhoneDigits.length >= 3) {
      const phoneHit = active.find((p) => p.phone && phoneDigits(p.phone) === typedPhoneDigits);
      if (phoneHit) return { name: phoneHit.name, mrno: phoneHit.mrno, matchedBy: 'phone' as const };
    }

    if (!typed) return null;
    let best: { name: string; mrno: string; score: number } | null = null;
    for (const p of active) {
      const score = nameSimilarity(p.name, typed);
      if (!best || score > best.score) best = { name: p.name, mrno: p.mrno, score };
    }
    return best && best.score >= DUPLICATE_NAME_THRESHOLD
      ? { name: best.name, mrno: best.mrno, matchedBy: 'name' as const }
      : null;
  }, [allPatients, newPatient.name, newPatient.phone]);

  // Most recently seen patients, for a quick-pick when the search box is
  // empty — the common case of "who's next" rather than "find someone
  // specific". Deduped to one entry per patient, most recent visit first.
  const recentVisitRows = useLiveQuery(
    () => (query.trim() || patient || creatingPatient ? undefined : dashboardService.recentVisits(clinic.id, 20)),
    [clinic.id, query, patient, creatingPatient]
  );
  const recentPatients = useMemo(() => {
    const seen = new Set<UUID>();
    const out: { patientId: UUID; patientName: string; mrno: string }[] = [];
    for (const row of recentVisitRows ?? []) {
      if (seen.has(row.patientId)) continue;
      seen.add(row.patientId);
      out.push({ patientId: row.patientId, patientName: row.patientName, mrno: row.mrno });
      if (out.length >= 5) break;
    }
    return out;
  }, [recentVisitRows]);

  const openPackages = useLiveQuery(async (): Promise<OpenPackage[]> => {
    if (!patient) return [];
    const visits = await repos.visits.list({ clinicId: clinic.id, patientId: patient.id });
    const groups = new Map<string, typeof visits>();
    for (const v of visits) {
      if (!v.packageGroupId) continue;
      if (!groups.has(v.packageGroupId)) groups.set(v.packageGroupId, []);
      groups.get(v.packageGroupId)!.push(v);
    }
    const items = await repos.catalog.list(clinic.id, true);
    const nameOf = new Map(items.map((i) => [i.id, i.name]));
    const open: OpenPackage[] = [];
    for (const [gid, group] of groups) {
      const total = group[0].packageTotal ?? 1;
      if (group.length >= total) continue;
      const sorted = [...group].sort((a, b) => a.visitDate.localeCompare(b.visitDate));
      open.push({
        packageGroupId: gid,
        serviceCatalogId: sorted[0].serviceCatalogId,
        serviceName: nameOf.get(sorted[0].serviceCatalogId) ?? 'Package',
        logged: group.length,
        packageTotal: total,
        startedOn: sorted[0].visitDate,
      });
    }
    return open.sort((a, b) => b.startedOn.localeCompare(a.startedOn));
  }, [clinic.id, patient?.id]);

  // "Repeat last visit": pre-fill patient/therapist/condition from the
  // visit being repeated, then — once that patient's open packages have
  // loaded — select the matching package so this becomes its next session.
  const repeatVisit = useLiveQuery(
    () => (search.repeatVisitId ? repos.visits.get(search.repeatVisitId) : undefined),
    [search.repeatVisitId]
  );

  // Patient Profile's "New visit" button and an Expected-today card linked
  // to a registered patient both arrive with ?patientId=… — skip search and
  // pre-select that patient directly, same as repeatVisit does below.
  const prefillPatient = useLiveQuery(
    () => (search.patientId ? repos.patients.get(search.patientId) : undefined),
    [search.patientId]
  );
  useEffect(() => {
    if (!prefillPatient || patient) return;
    setPatient(prefillPatient);
    if (prefillPatient.primaryCondition) setCondition(prefillPatient.primaryCondition);
  }, [prefillPatient, patient]);

  // An Expected-today entry with no linked patient yet arrives with
  // ?prefillName=… instead — open the create-patient form directly with the
  // name already filled in, rather than dropping it into the search box and
  // making the receptionist take a second step to get to the same form.
  useEffect(() => {
    if (search.prefillName && !patient && !search.patientId && !creatingPatient) {
      setCreatingPatient(true);
      setNewPatient((p) => (p.name ? p : { ...p, name: search.prefillName! }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.prefillName]);

  useEffect(() => {
    if (!repeatVisit || patient) return;
    (async () => {
      const p = await repos.patients.get(repeatVisit.patientId);
      if (p) {
        setPatient(p);
        setCondition(repeatVisit.condition ?? p.primaryCondition ?? '');
      }
      setTherapistId(repeatVisit.therapistId);
      // Same service and bill as the visit being repeated either way — for
      // a package continuation this just seeds sensible values before the
      // effect below (once openPackages has loaded) switches the mode and
      // picks the matching package; for an ordinary one-off repeat (no
      // package involved) this IS the whole pre-fill, which used to be
      // skipped entirely — every repeat got forced into continuation mode
      // regardless of whether there was a package to continue, landing on
      // an empty, unpickable "Open package" field for a plain repeat visit.
      setServiceCatalogId(repeatVisit.serviceCatalogId);
      setBillOverride(repeatVisit.actualBillPaise);
      setMode(repeatVisit.packageGroupId ? 'continuation' : 'new');
    })();
  }, [repeatVisit, patient]);

  // The confirmed patient's own visit history — feeds both the therapist
  // default below and the "last session" detail on the confirmed chip, so
  // it's one query instead of two.
  const patientVisits = useLiveQuery(
    () => (patient ? repos.visits.list({ clinicId: clinic.id, patientId: patient.id }) : undefined),
    [clinic.id, patient?.id]
  );
  const lastVisit = useMemo(() => {
    const rows = (patientVisits ?? []).filter((v) => !v.deleted);
    if (!rows.length) return null;
    return [...rows].sort((a, b) => b.visitDate.localeCompare(a.visitDate))[0];
  }, [patientVisits]);
  const invoicePayments = useLiveQuery(() => repos.invoicePayments.list(clinic.id), [clinic.id]);
  const statusByInvoiceId = useMemo(
    () => new Map((invoicePayments ?? []).map((p) => [p.invoiceId, p.status])),
    [invoicePayments]
  );
  const lastVisitDirectPayments = useLiveQuery(
    () => (lastVisit ? repos.payments.listByVisit(lastVisit.id) : undefined),
    [lastVisit?.id]
  );
  const lastVisitDirectPaymentPaise = (lastVisitDirectPayments ?? []).reduce((sum, p) => sum + p.amountPaise, 0);
  const catalogNameById = useMemo(() => new Map((catalog ?? []).map((c) => [c.id, c.name])), [catalog]);

  // Default therapist when patient is selected: whoever saw them last, or
  // left blank (manual pick) if this is their first visit. Skipped for a
  // "repeat last visit" — that flow already set the therapist from the
  // specific visit being repeated, which may not be this patient's most
  // recent one, and shouldn't be silently overwritten once it resolves.
  useEffect(() => {
    if (!patient || patientVisits === undefined || search.repeatVisitId) return;
    setTherapistId(lastVisit?.therapistId ?? '');
  }, [patient, patientVisits, lastVisit?.therapistId, search.repeatVisitId]);

  useEffect(() => {
    if (!repeatVisit?.packageGroupId || openPackages === undefined) return;
    const match = openPackages.find((op) => op.packageGroupId === repeatVisit.packageGroupId);
    if (match) {
      setOpenPackageId(match.packageGroupId);
    } else {
      // The package this visit belonged to has since closed (every session
      // logged) — fall back to a plain repeat of the same service instead
      // of leaving the form on continuation mode with no open package left
      // to pick. Service and bill were already pre-filled by the effect
      // above.
      setMode('new');
    }
  }, [repeatVisit, openPackages]);

  // Default therapist to current user's therapist when creating a new patient
  // or selecting a patient for 'new' mode (unless therapist is already selected)
  useEffect(() => {
    if (!patient || therapistId || !myTherapistId) return;
    setTherapistId(myTherapistId);
  }, [patient, therapistId, myTherapistId]);

  const selectedService = useMemo(
    () => (catalog ?? []).find((c) => c.id === serviceCatalogId),
    [catalog, serviceCatalogId]
  );
  const selectedPackage = useMemo(
    () => (openPackages ?? []).find((p) => p.packageGroupId === openPackageId),
    [openPackages, openPackageId]
  );

  const catalogPricePaise = mode === 'continuation' ? 0 : (selectedService?.basePricePaise ?? 0);
  const billPaise = billOverride ?? catalogPricePaise;
  const adjustmentPaise = billPaise - catalogPricePaise;

  const categories = useMemo(() => {
    const map = new Map<string, NonNullable<typeof catalog>>();
    for (const item of catalog ?? []) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return [...map.entries()];
  }, [catalog]);

  function selectPatientFromSearch(p: Patient) {
    setPatient(p);
    setQuery('');
    if (p.primaryCondition) setCondition(p.primaryCondition);
  }

  function startCreatingPatient() {
    setNewPatient((p) => ({ ...p, name: p.name || query.trim() }));
    setCreatingPatient(true);
  }

  function backToSearch() {
    setCreatingPatient(false);
    setQuery('');
  }

  async function createPatient() {
    setError(null);
    try {
      const created = await patientService.create({
        clinicId: clinic.id,
        name: newPatient.name,
        mrno: newPatient.mrno || undefined,
        age: newPatient.age ? Number(newPatient.age) : null,
        sex: (newPatient.sex || null) as Patient['sex'],
        phone: newPatient.phone || null,
        primaryCondition: newPatient.primaryCondition || null,
        referringSource: newPatient.referringSource || null,
        referringSourceDetail: newPatient.referringSourceDetail || null,
      });
      setPatient(created);
      setCreatingPatient(false);
      if (created.primaryCondition) setCondition(created.primaryCondition);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  async function save() {
    setError(null);
    if (!patient) return setError('Select or create a patient first');
    if (!therapistId) return setError('Select a therapist');
    if (mode === 'new' && !serviceCatalogId) return setError('Select a service');
    if (mode === 'continuation' && !selectedPackage) return setError('Select the open package');
    setBusy(true);
    try {
      const visit = await visitService.create({
        clinicId: clinic.id,
        patientId: patient.id,
        therapistId,
        visitDate,
        serviceCatalogId: mode === 'continuation' ? selectedPackage!.serviceCatalogId : serviceCatalogId,
        condition,
        treatmentNotes: notes,
        actualBillPaise: billOverride ?? undefined,
        adjustmentReason,
        ...(mode === 'continuation'
          ? {
              isContinuation: true,
              packageGroupId: selectedPackage!.packageGroupId,
              sessionIndex: selectedPackage!.logged + 1,
              packageTotal: selectedPackage!.packageTotal,
            }
          : {}),
        ...(billPaise > 0 && canBill && paymentChoice === 'pending'
          ? { pendingPaymentNote: pendingNote || null }
          : {}),
      });

      // Billed and marked paid on the spot — log the cash/UPI/etc payment
      // immediately so it counts toward "collected" without needing an
      // invoice. A ₹0 continuation session or an explicit "collect later"
      // choice skips this; the latter shows up on Workspace's pending list.
      // Skipped entirely without billing access — the visit saves as
      // genuinely unbilled, for whoever does handle billing to collect
      // from later (same Workspace pending-list path).
      if (billPaise > 0 && canBill && paymentChoice === 'paid') {
        await directPaymentService.logPayment(clinic.id, visit.id, billPaise, paymentMethod, visitDate, null);
      }

      if (clinic.clinicalDocsEnabled) {
        setJustSaved({ visitId: visit.id, patientId: patient.id, patientName: patient.name });
      } else {
        void navigate({ to: '/workspace' });
      }
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (justSaved) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <SectionCard title="Visit logged">
          <p className="text-sm text-[var(--ink)]">Visit saved for {justSaved.patientName}.</p>
          <div className="mt-4 flex gap-2">
            <Link
              to="/patients/$patientId/notes/new"
              params={{ patientId: justSaved.patientId }}
              search={{ visitId: justSaved.visitId }}
              className={btnPrimary}
            >
              Add clinical note
            </Link>
            <button className={btnSecondary} onClick={() => void navigate({ to: '/workspace' })}>
              Done
            </button>
          </div>
        </SectionCard>
      </div>
    );
  }

  const patientPanel = (
    <SectionCard title="Patient">
      {patient ? (
        // Confirmed — collapsed to an identity header, reference tiles, and
        // a single way back to search. No outstanding-balance figure here
        // (that's a billing/collections concern, already surfaced on the
        // Ledger table and Patient Profile) — last visit and open-package
        // progress are what's actually decision-relevant while logging a
        // new one.
        <div className="space-y-3">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="font-display text-sm font-medium text-[var(--ink)]">{patient.name}</div>
              <div className="text-xs text-[var(--muted)]">
                Patient ID {patient.mrno}
                {patient.age != null && ` · ${patient.age}y`}
                {patient.sex && ` · ${patient.sex}`}
                {patient.primaryCondition && ` · ${patient.primaryCondition}`}
              </div>
            </div>
            <button
              className="shrink-0 text-xs text-[var(--teal)] hover:underline"
              onClick={() => setEditingPatient(true)}
            >
              Edit details
            </button>
          </div>

          {patientVisits !== undefined && (
            <SummaryTile label="Last visit">
              {lastVisit ? (
                (() => {
                  const state = computeVisitPaymentState(
                    lastVisit.actualBillPaise,
                    lastVisit.invoiceId,
                    lastVisitDirectPaymentPaise,
                    lastVisit.invoiceId ? statusByInvoiceId.get(lastVisit.invoiceId) : undefined
                  );
                  const chip = PAYMENT_CHIP[state];
                  return (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>
                        {formatDateDMY(lastVisit.visitDate)} — {catalogNameById.get(lastVisit.serviceCatalogId) ?? 'service'}
                      </span>
                      <Pill tone={chip.tone}>{chip.label(formatINR(lastVisit.actualBillPaise))}</Pill>
                    </div>
                  );
                })()
              ) : (
                <span className="text-[var(--muted)]">No previous visits on record</span>
              )}
            </SummaryTile>
          )}

          {openPackages !== undefined && (
            <SummaryTile label="Package">
              {openPackages.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span>
                    {openPackages[0].serviceName} — {openPackages[0].logged} of {openPackages[0].packageTotal} used
                  </span>
                  <PackageThread sessionIndex={openPackages[0].logged + 1} packageTotal={openPackages[0].packageTotal} />
                  <span className="text-xs text-[var(--muted)]">
                    started {formatDateDMY(openPackages[0].startedOn)}
                  </span>
                </div>
              ) : (
                <span className="text-[var(--muted)]">No open package</span>
              )}
            </SummaryTile>
          )}

          {!search.patientId && (
            <button
              className={`${btnSecondary} w-full`}
              onClick={() => {
                setPatient(null);
                setCreatingPatient(false);
                setQuery('');
              }}
            >
              Change patient
            </button>
          )}
        </div>
      ) : creatingPatient ? (
          // Creating — no existing match; capture the new patient. Only
          // name and phone are asked for up front, everything else is
          // explicitly optional and can be filled in later from the profile.
          // Single column, not sm:grid-cols-2 -- this always renders in the
          // fixed-width side panel now, and sm: is a viewport breakpoint,
          // not a container one, so it would force two columns into a
          // panel too narrow for them on any normal-width screen.
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3">
              <Field label="Name *">
                <input
                  className={inputCls}
                  value={newPatient.name}
                  onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })}
                  placeholder="Patient name"
                  autoFocus
                />
              </Field>
              <Field label="Phone">
                <input
                  className={inputCls}
                  placeholder="Recommended — used for search and quick pick"
                  value={newPatient.phone}
                  onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })}
                />
              </Field>
              {duplicateMatch && (
                <p className="col-span-2 rounded-md border border-[var(--rust)] bg-[var(--rust-light)] px-3 py-2 text-xs text-[var(--rust)]">
                  ⚠{' '}
                  {duplicateMatch.matchedBy === 'phone'
                    ? `A patient with this phone number — "${duplicateMatch.name}" (ID ${duplicateMatch.mrno}) — already exists.`
                    : `A patient named "${duplicateMatch.name}" (ID ${duplicateMatch.mrno}) already exists.`}{' '}
                  Use "Back to search" below if this is the same person.
                </p>
              )}
              {!newPatient.phone.trim() && (
                <p className="col-span-2 text-xs text-[var(--muted)]">
                  No phone on file — fine for a walk-in with none, but it limits later search and duplicate checks.
                </p>
              )}
              <Field label="ID (optional)">
                <input
                  className={inputCls}
                  placeholder="Leave blank to auto-generate"
                  value={newPatient.mrno}
                  onChange={(e) => setNewPatient({ ...newPatient, mrno: e.target.value })}
                />
              </Field>
              <Field label="Age">
                <input
                  type="number"
                  className={inputCls}
                  placeholder="Optional"
                  value={newPatient.age}
                  onChange={(e) => setNewPatient({ ...newPatient, age: e.target.value })}
                />
              </Field>
              <Field label="Sex">
                <select
                  className={inputCls}
                  value={newPatient.sex}
                  onChange={(e) => setNewPatient({ ...newPatient, sex: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="M">M</option>
                  <option value="F">F</option>
                  <option value="Other">Other</option>
                </select>
              </Field>
              <Field label="Primary condition">
                <input
                  className={inputCls}
                  placeholder="e.g. Neck Pain"
                  value={newPatient.primaryCondition}
                  onChange={(e) => setNewPatient({ ...newPatient, primaryCondition: e.target.value })}
                />
              </Field>
              <Field label="Referring source">
                <select
                  className={inputCls}
                  value={newPatient.referringSource}
                  onChange={(e) =>
                    setNewPatient({
                      ...newPatient,
                      referringSource: e.target.value as ReferringSource | '',
                      referringSourceDetail: '',
                    })
                  }
                >
                  <option value="">—</option>
                  {(Object.entries(REFERRING_SOURCE_LABELS) as [ReferringSource, string][]).map(
                    ([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    )
                  )}
                </select>
              </Field>
              {referringSourceDetailLabel(newPatient.referringSource) && (
                <Field label={referringSourceDetailLabel(newPatient.referringSource)!}>
                  <input
                    className={inputCls}
                    value={newPatient.referringSourceDetail}
                    onChange={(e) => setNewPatient({ ...newPatient, referringSourceDetail: e.target.value })}
                  />
                </Field>
              )}
            </div>
            <p className="text-xs text-[var(--muted)]">You can complete the rest of these later from the profile.</p>
            <div className="flex gap-2">
              <button
                className={btnPrimary}
                disabled={!newPatient.name.trim()}
                onClick={() => void createPatient()}
              >
                Create patient
              </button>
              <button className={btnSecondary} onClick={backToSearch}>
                Back to search
              </button>
            </div>
          </div>
        ) : (
          // Searching — the default state. A single box matches Patient ID,
          // name, or phone; a recent-patients quick-pick covers the common
          // "who's next" case without typing anything.
          <div className="space-y-3">
            <input
              className={inputCls}
              placeholder="Search by Patient ID, name, or phone…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query.trim() ? (
              <>
                {(matches ?? []).map((p) => (
                  <button
                    key={p.id}
                    className="flex w-full items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-left text-sm hover:bg-[var(--paper)]"
                    onClick={() => selectPatientFromSearch(p)}
                  >
                    <span>{p.name}</span>
                    <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
                  </button>
                ))}
                {matches?.length === 0 && (
                  <p className="rounded-md border border-[var(--border)] bg-[var(--paper)] p-2 text-xs text-[var(--muted)]">
                    No existing patient found.
                  </p>
                )}
              </>
            ) : (
              recentPatients.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-[var(--muted)]">Recently seen</p>
                  <div className="flex flex-wrap gap-1.5">
                    {recentPatients.map((p) => (
                      <button
                        key={p.patientId}
                        className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--ink)] hover:bg-[var(--paper)]"
                        onClick={() =>
                          void repos.patients.get(p.patientId).then((full) => full && selectPatientFromSearch(full))
                        }
                      >
                        {p.patientName} <span className="text-[var(--muted)]">{p.mrno}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            )}
            <button className={btnSecondary} onClick={startCreatingPatient}>
              + New patient
            </button>
          </div>
        )}
      </SectionCard>
  );

  const visitPanel = (
    <div className="space-y-4">
      <SectionCard title="Visit">
        {/* Single column throughout, matching the Patient panel above —
            the previous sm:grid-cols-2 paired up whichever two fields
            happened to land in the same row by grid auto-placement, which
            shifted depending on runtime state (adjustment reason showing
            or not, payment section showing or not): unrelated fields at
            different heights ended up side by side, and a long dynamic
            label (e.g. "Adjustment reason * (discount of ₹500)") had to
            wrap inside a half-width column, visually crowding its own
            input. One column removes the ambiguity entirely. */}
        <div className="grid grid-cols-1 gap-3">
          <Field label="Date">
            <input
              type="date"
              className={inputCls}
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
            />
          </Field>
          <Field label="Therapist *">
            <select
              className={inputCls}
              value={therapistId}
              onChange={(e) => setTherapistId(e.target.value)}
            >
              <option value="">Select…</option>
              {(therapists ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>

          <SegmentedToggle
            value={mode}
            onChange={(v) => {
              setMode(v);
              setBillOverride(null);
            }}
            options={[
              { value: 'new', label: 'New service / package' },
              {
                value: 'continuation',
                label: `Continuation (₹0)${patient && !openPackages?.length ? ' — none open' : ''}`,
                disabled: !openPackages?.length,
              },
            ]}
          />

          {mode === 'new' ? (
            <Field label="Service *">
              <select
                className={inputCls}
                value={serviceCatalogId}
                onChange={(e) => {
                  setServiceCatalogId(e.target.value);
                  setBillOverride(null);
                  setAdjustmentReason('');
                }}
              >
                <option value="">Select…</option>
                {categories.map(([category, items]) => (
                  <optgroup key={category} label={category}>
                    {items.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name} — {formatINR(i.basePricePaise)}
                        {i.sessionCount > 1 &&
                          ` (${i.sessionCount} sessions, ${formatINR(effectivePricePerSession(i))}/session)`}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Open package *">
              <select
                className={inputCls}
                value={openPackageId}
                onChange={(e) => setOpenPackageId(e.target.value)}
              >
                <option value="">Select…</option>
                {(openPackages ?? []).map((p) => (
                  <option key={p.packageGroupId} value={p.packageGroupId}>
                    {p.serviceName} — session {p.logged + 1} of {p.packageTotal} (started{' '}
                    {formatDateDMY(p.startedOn)})
                  </option>
                ))}
              </select>
            </Field>
          )}

          <Field
            label={
              mode === 'continuation'
                ? 'Bill amount (₹0 unless topping up)'
                : `Bill amount${selectedService ? ` (catalog: ${formatINR(selectedService.basePricePaise)})` : ''}`
            }
          >
            <RupeeInput valuePaise={billOverride ?? catalogPricePaise} onChange={setBillOverride} />
          </Field>

          {adjustmentPaise !== 0 && (
            <Field
              label={`Adjustment reason * (${adjustmentPaise < 0 ? 'discount' : 'top-up'} of ${formatINR(Math.abs(adjustmentPaise))})`}
            >
              <input
                className={inputCls}
                placeholder="e.g. loyalty discount, added session"
                value={adjustmentReason}
                onChange={(e) => setAdjustmentReason(e.target.value)}
              />
            </Field>
          )}

          {billPaise > 0 && !canBill && (
            <p className="text-xs text-[var(--muted)]">
              This visit will be saved as unbilled — billing is handled separately at this clinic.
            </p>
          )}

          {billPaise > 0 && canBill && (
            <Field label="Payment">
              <SegmentedToggle
                value={paymentChoice}
                onChange={setPaymentChoice}
                options={[
                  { value: 'paid', label: 'Paid now' },
                  { value: 'pending', label: 'Collect later' },
                ]}
              />
              {paymentChoice === 'paid' ? (
                <select
                  className={`${inputCls} mt-2`}
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                >
                  {PAYMENT_METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  className={`${inputCls} mt-2`}
                  placeholder="Optional note — e.g. will pay next Monday"
                  value={pendingNote}
                  onChange={(e) => setPendingNote(e.target.value)}
                />
              )}
            </Field>
          )}

          <Field label="Condition (this visit)">
            <input
              className={inputCls}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            />
          </Field>
          <Field label="Treatment notes">
            <input
              className={inputCls}
              placeholder='e.g. "FM An/Re S,S", "CST Sph Dysfunction"'
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </Field>
        </div>
      </SectionCard>

      <ErrorNote message={error} />
      <div className="flex gap-2">
        <button className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save visit'}
        </button>
        <button className={btnSecondary} onClick={() => void navigate({ to: '/workspace' })}>
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)]">New visit</h1>

      {/* Same two-column shape (reference panel left, form right) whether or
          not a patient is picked yet — the *content* inside the left panel
          changes (search/create UI vs. confirmed-patient tiles), but the
          page's own structure doesn't, so picking a patient doesn't cause a
          jarring column-count/width jump. Collapses to stacked below tab:. */}
      <div className="tab:flex tab:items-start tab:gap-4">
        <div className="tab:w-80 tab:shrink-0">{patientPanel}</div>
        <div className="mt-4 min-w-0 flex-1 tab:mt-0">{visitPanel}</div>
      </div>

      {patient && editingPatient && (
        <EditPatientModal
          patient={patient}
          open={editingPatient}
          onClose={() => setEditingPatient(false)}
          onSave={async () => {
            const fresh = await repos.patients.get(patient.id);
            if (fresh) setPatient(fresh);
            setEditingPatient(false);
          }}
        />
      )}
    </div>
  );
}
