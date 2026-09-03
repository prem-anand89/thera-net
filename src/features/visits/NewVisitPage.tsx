import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  repos,
  visitService,
  patientService,
  directPaymentService,
  dashboardService,
  feedbackService,
  bookingService,
} from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useSession } from '@/app/useSession';
import { usePermissions } from '@/app/usePermissions';
import { useEntitlements } from '@/app/useEntitlements';
import { formatINR } from '@/domain/money';
import { formatDateDMY } from '@/domain/fiscalYear';
import { DUPLICATE_NAME_THRESHOLD, nameSimilarity } from '@/domain/nameSimilarity';
import {
  effectivePricePerSession,
  type Patient,
  type PaymentMethod,
  type UUID,
} from '@/domain/types';
import { toFriendlyMessage } from '@/lib/errors';
import {
  Field,
  inputCls,
  btnPrimary,
  btnSecondary,
  ErrorNote,
  SectionCard,
  Pill,
  PackageThread,
  MultiToggle,
} from '@/components/ui';
import { SearchableSelect } from '@/components/SearchableSelect';
import { EditPatientModal } from '@/features/patients/EditPatientModal';
import { IssueInvoiceDialog, type IssueInvoiceTarget } from '@/components/IssueInvoiceDialog';
import { PAYMENT_CHIP } from '@/components/VisitCard';
import {
  computeVisitPaymentState,
  isPackageContinuation,
  paymentBadge,
} from '@/domain/paymentState';
import {
  computeAdjustedBillPaise,
  inferBillAdjustment,
  type BillAdjustmentMode,
  type BillAdjustmentValueType,
} from '@/domain/billAdjustment';
import { BillAdjustmentFields, billAdjustmentFromFields } from '@/components/BillAdjustmentFields';
import { ShowUpiQrButton } from '@/components/UpiQrModal';

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

// UPI first — the most common collection method at an Indian clinic front
// desk, so it's both the default (see paymentMethod's useState below) and
// the top option here instead of making staff scroll past Cash every time.
const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'upi', label: 'UPI' },
  { value: 'cash', label: 'Cash' },
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
  const { canBill, role } = usePermissions();
  const navigate = useNavigate();
  const { session } = useSession();
  const entitlements = useEntitlements(clinic.id);
  const search = useSearch({ strict: false }) as {
    repeatVisitId?: string;
    patientId?: string;
    prefillName?: string;
    prefillPhone?: string;
    appointmentId?: string;
  };

  // "Done"/"Cancel" used to always land on Workspace, even when this page
  // was opened from a patient's own profile (via its "New visit" button,
  // which passes patientId) — leaving that patient behind instead of
  // returning to them.
  function goBack() {
    if (search.patientId) {
      void navigate({ to: '/patients/$patientId', params: { patientId: search.patientId } });
    } else {
      void navigate({ to: '/workspace' });
    }
  }

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
    phone: search.prefillPhone ?? '',
    primaryCondition: '',
    referringSourceId: '',
    referringSourceDetail: '',
  });
  const referringSources =
    useLiveQuery(() => repos.referringSourceCatalog.list(clinic.id), [clinic.id]) ?? [];

  // Visit fields
  const today = new Date().toISOString().slice(0, 10);
  const [visitDate, setVisitDate] = useState(today);
  const [therapistId, setTherapistId] = useState('');
  const [mode, setMode] = useState<'new' | 'continuation'>('new');
  const [serviceCatalogId, setServiceCatalogId] = useState('');
  const [openPackageId, setOpenPackageId] = useState('');
  const [adjustmentMode, setAdjustmentMode] = useState<BillAdjustmentMode>('none');
  const [adjustmentValueType, setAdjustmentValueType] = useState<BillAdjustmentValueType>('amount');
  const [adjustmentValue, setAdjustmentValue] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [condition, setCondition] = useState('');
  const [notes, setNotes] = useState('');
  const [treatmentIds, setTreatmentIds] = useState<string[]>([]);
  // Front desk usually doesn't know condition/treatments at log time —
  // that's the therapist's own read of the patient, not something
  // reception can fill in from a booking or a walk-in. Collapsed by
  // default for that role only (still there, one click away — never
  // hidden from admin/therapist, who typically do know this) so their
  // path is Patient → Therapist → Service → Payment, the four things
  // front desk always has, without a clinical field sitting between.
  const [clinicalDetailsExpanded, setClinicalDetailsExpanded] = useState(false);
  // Two prefill paths can fill `condition` in behind this collapsed
  // section before front desk ever opens it — the ?patientId= prefill
  // effect (from the patient's own primaryCondition) and "Repeat last
  // visit" (from the prior visit's own condition). Either way, a value
  // that's about to be submitted needs to be visible, not carried over
  // silently behind a "+ Add condition / treatments (optional)" button
  // that still reads as empty.
  useEffect(() => {
    if (role === 'front_desk' && !clinicalDetailsExpanded && condition) {
      setClinicalDetailsExpanded(true);
    }
  }, [role, clinicalDetailsExpanded, condition]);
  const [paymentChoice, setPaymentChoice] = useState<'paid' | 'pending'>('paid');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('upi');
  const [pendingNote, setPendingNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set only when the clinic has clinical docs on — swaps the form for a
  // one-time "add a note now?" offer at the highest-intent moment, right
  // after saving while the therapist is still on the page. Clinics that
  // haven't opted in see no change: save still navigates straight to
  // Workspace.
  const [justSaved, setJustSaved] = useState<{
    visitId: UUID;
    patientId: UUID;
    patientName: string;
    patientPhone: string | null;
    serviceLabel: string;
    isPackage: boolean;
    alreadyCollected: boolean;
    therapistId: UUID;
  } | null>(null);
  const [invoicing, setInvoicing] = useState(false);
  // Patient Communications, Slice 1 — tracks whether the post-save "Ask
  // for feedback" button has already been clicked for this visit, so it
  // can't be double-fired (the RLS unique-pending-request-per-visit index
  // would just reject the second insert, but disabling reads clearer).
  const [feedbackRequested, setFeedbackRequested] = useState(false);

  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id), [clinic.id]);
  const myTherapistId = useMemo(
    () => (therapists ?? []).find((t) => t.userId === session?.user?.id)?.id,
    [therapists, session?.user?.id]
  );
  const catalog = useLiveQuery(() => repos.catalog.list(clinic.id), [clinic.id]);
  const treatments = useLiveQuery(() => repos.treatmentCatalog.list(clinic.id), [clinic.id]) ?? [];
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
      if (phoneHit)
        return { name: phoneHit.name, mrno: phoneHit.mrno, matchedBy: 'phone' as const };
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
    () =>
      query.trim() || patient || creatingPatient
        ? undefined
        : dashboardService.recentVisits(clinic.id, 20),
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

  // An appointment with no linked patient yet (Patient Communications,
  // Slice 5 — "Create visit" from Requests → Bookings or Workspace's
  // "Expected today") arrives with ?prefillName=&prefillPhone=… instead —
  // open the create-patient form directly with both fields already
  // filled in, rather than dropping just the name into the search box.
  // The same existing name/phone-match typeahead this effect feeds
  // surfaces likely-existing-patient candidates for free; staff still
  // pick or create explicitly, never auto-selected (see
  // HANDOFF-patient-comms.md's "no silent find-or-create" rule).
  useEffect(() => {
    if (search.prefillName && !patient && !search.patientId && !creatingPatient) {
      setCreatingPatient(true);
      setNewPatient((p) => ({
        ...p,
        name: p.name || search.prefillName!,
        phone: p.phone || search.prefillPhone || '',
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.prefillName, search.prefillPhone]);

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
      const inferred = inferBillAdjustment(
        repeatVisit.catalogPricePaise,
        repeatVisit.actualBillPaise
      );
      setAdjustmentMode(inferred.mode);
      setAdjustmentValueType(inferred.valueType);
      setAdjustmentValue(inferred.value > 0 ? String(inferred.value) : '');
      setAdjustmentReason(repeatVisit.adjustmentReason ?? '');
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
  const lastVisitDirectPaymentPaise = (lastVisitDirectPayments ?? []).reduce(
    (sum, p) => sum + p.amountPaise,
    0
  );
  // D2's Overdue anchor (max(visitDate, issuedAt)) — this page only ever
  // needs one visit's invoice, so a direct get() rather than a clinic-wide
  // map (statusByInvoiceId above answers a different question — status,
  // not issue date).
  const lastVisitInvoice = useLiveQuery(
    () => (lastVisit?.invoiceId ? repos.invoices.get(lastVisit.invoiceId) : undefined),
    [lastVisit?.invoiceId]
  );
  const catalogNameById = useMemo(
    () => new Map((catalog ?? []).map((c) => [c.id, c.name])),
    [catalog]
  );

  // Default therapist when patient is selected: whoever saw them last, or
  // left blank (manual pick) if this is their first visit. Skipped for a
  // "repeat last visit" — that flow already set the therapist from the
  // specific visit being repeated, which may not be this patient's most
  // recent one, and shouldn't be silently overwritten once it resolves.
  useEffect(() => {
    if (!patient || patientVisits === undefined || search.repeatVisitId) return;
    // Returning patients default to whoever saw them last. First visits
    // leave the current pick alone — blanking it raced with the user's
    // (or myTherapistId's) selection once Dexie resolved an empty history.
    if (lastVisit?.therapistId) setTherapistId(lastVisit.therapistId);
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
  const billPaise = computeAdjustedBillPaise(
    catalogPricePaise,
    billAdjustmentFromFields(adjustmentMode, adjustmentValueType, adjustmentValue)
  );
  const adjustmentPaise = billPaise - catalogPricePaise;

  function resetBillAdjustment() {
    setAdjustmentMode('none');
    setAdjustmentValueType('amount');
    setAdjustmentValue('');
    setAdjustmentReason('');
  }

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
        referringSourceId: newPatient.referringSourceId || null,
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
    if (adjustmentPaise !== 0 && !adjustmentReason.trim()) {
      return setError('Enter a reason for the bill adjustment');
    }
    if (
      entitlements.enforcementEnabled &&
      entitlements.visitCapPerMonth != null &&
      entitlements.visitsThisMonth >= entitlements.visitCapPerMonth
    ) {
      return setError(
        `This clinic's plan allows ${entitlements.visitCapPerMonth} visits per month, and that limit's been reached. Upgrade to log more.`
      );
    }
    setBusy(true);
    try {
      const visit = await visitService.create({
        clinicId: clinic.id,
        patientId: patient.id,
        therapistId,
        visitDate,
        serviceCatalogId:
          mode === 'continuation' ? selectedPackage!.serviceCatalogId : serviceCatalogId,
        condition,
        treatmentNotes: notes,
        treatmentIds,
        actualBillPaise: adjustmentPaise !== 0 ? billPaise : undefined,
        adjustmentReason: adjustmentPaise !== 0 ? adjustmentReason : undefined,
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
        await directPaymentService.logPayment(
          clinic.id,
          visit.id,
          billPaise,
          paymentMethod,
          visitDate,
          null
        );
      }

      // Slice 5: this visit is arrival for the appointment it was started
      // from ("Create visit" on Requests → Bookings / Workspace's
      // "Expected today") — resolve patient_id/visit_id and flip the
      // appointment to arrived. Doesn't block the save-succeeded screen
      // below on this secondary link; the visit itself already saved.
      if (search.appointmentId) {
        void bookingService
          .linkAppointmentVisit(search.appointmentId, visit.id, patient.id)
          .catch((e) => console.error('Could not link this visit to its appointment', e));
      }

      setJustSaved({
        visitId: visit.id,
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        serviceLabel:
          mode === 'continuation'
            ? selectedPackage!.serviceName
            : (selectedService?.name ?? 'Visit'),
        isPackage: mode === 'continuation',
        alreadyCollected: billPaise > 0 && canBill && paymentChoice === 'paid',
        therapistId,
      });
      setFeedbackRequested(false);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (justSaved) {
    const otherPrimaryShown = clinic.clinicalDocsEnabled || canBill;
    const invoiceTarget: IssueInvoiceTarget = {
      visitId: justSaved.visitId,
      patientId: justSaved.patientId,
      patientLabel: justSaved.patientName,
      serviceLabel: justSaved.serviceLabel,
      isPackage: justSaved.isPackage,
      alreadyCollected: justSaved.alreadyCollected,
    };
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <SectionCard title="Visit logged">
          <p className="text-sm text-[var(--ink)]">Visit saved for {justSaved.patientName}.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {canBill && (
              <button type="button" className={btnPrimary} onClick={() => setInvoicing(true)}>
                Issue invoice
              </button>
            )}
            {clinic.clinicalDocsEnabled && (
              <Link
                to="/patients/$patientId/notes/new"
                params={{ patientId: justSaved.patientId }}
                search={{ visitId: justSaved.visitId }}
                className={btnPrimary}
              >
                Add clinical note
              </Link>
            )}
            {clinic.enablePatientComms && (
              <button
                type="button"
                className={btnSecondary}
                disabled={feedbackRequested}
                onClick={() => {
                  setFeedbackRequested(true);
                  void feedbackService
                    .askForFeedback(
                      justSaved.visitId,
                      justSaved.patientName,
                      justSaved.patientPhone,
                      clinic.name
                    )
                    .catch((e) => {
                      setFeedbackRequested(false);
                      setError(toFriendlyMessage(e));
                    });
                }}
                title="Ask this patient for feedback"
              >
                {feedbackRequested ? 'Sent ✓' : 'Feedback'}
              </button>
            )}
            <button
              type="button"
              className={otherPrimaryShown ? btnSecondary : btnPrimary}
              onClick={() => {
                setJustSaved(null);
                void navigate({ to: '/visits/new', search: { patientId: justSaved.patientId } });
              }}
            >
              Another visit for {justSaved.patientName}
            </button>
            <button type="button" className={btnSecondary} onClick={goBack}>
              Done
            </button>
          </div>
        </SectionCard>
        {invoicing && (
          <IssueInvoiceDialog
            clinicId={clinic.id}
            target={invoiceTarget}
            onClose={() => setInvoicing(false)}
            returnTo="/visits/new"
          />
        )}
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
              <div className="font-display text-sm font-medium text-[var(--ink)]">
                {patient.name}
              </div>
              <div className="text-xs text-[var(--muted)]">
                Patient ID {patient.mrno}
                {patient.age != null && ` · ${patient.age}y`}
                {patient.sex && ` · ${patient.sex}`}
                {patient.primaryCondition && ` · ${patient.primaryCondition}`}
              </div>
            </div>
            <button
              type="button"
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
                  const badge = paymentBadge({
                    state,
                    billPaise: lastVisit.actualBillPaise,
                    collectedPaise: lastVisitDirectPaymentPaise,
                    visitDate: lastVisit.visitDate,
                    issuedAt: lastVisitInvoice?.issuedAt,
                    isPackageSession: isPackageContinuation(
                      lastVisit.sessionIndex,
                      lastVisit.packageTotal
                    ),
                  });
                  return (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span>
                        {formatDateDMY(lastVisit.visitDate)} —{' '}
                        {catalogNameById.get(lastVisit.serviceCatalogId) ?? 'service'}
                      </span>
                      <Pill tone={PAYMENT_CHIP[badge.kind].tone}>
                        <span title={badge.title}>{badge.label}</span>
                      </Pill>
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
                    {openPackages[0].serviceName} — {openPackages[0].logged} of{' '}
                    {openPackages[0].packageTotal} used
                  </span>
                  <PackageThread
                    sessionIndex={openPackages[0].logged + 1}
                    packageTotal={openPackages[0].packageTotal}
                  />
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
              type="button"
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
        // panel too narrow for them on any normal-width screen. None of
        // the fields below may carry col-span-2 either, even though the
        // grid is single-column already -- a spanning child still forces
        // CSS Grid to open a second implicit column and auto-place every
        // other field two-per-row into it, silently reintroducing the
        // exact squeeze this comment says was ruled out.
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
              <p className="rounded-md border border-[var(--rust)] bg-[var(--rust-light)] px-3 py-2 text-xs text-[var(--rust)]">
                ⚠{' '}
                {duplicateMatch.matchedBy === 'phone'
                  ? `A patient with this phone number — "${duplicateMatch.name}" (ID ${duplicateMatch.mrno}) — already exists.`
                  : `A patient named "${duplicateMatch.name}" (ID ${duplicateMatch.mrno}) already exists.`}{' '}
                Use "Back to search" below if this is the same person.
              </p>
            )}
            {!newPatient.phone.trim() && (
              <p className="text-xs text-[var(--muted)]">
                No phone on file — fine for a walk-in with none, but it limits later search and
                duplicate checks.
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
                value={newPatient.referringSourceId}
                onChange={(e) =>
                  setNewPatient({
                    ...newPatient,
                    referringSourceId: e.target.value,
                    referringSourceDetail: '',
                  })
                }
              >
                <option value="">—</option>
                {referringSources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            {referringSources.find((s) => s.id === newPatient.referringSourceId)?.detailLabel && (
              <Field
                label={
                  referringSources.find((s) => s.id === newPatient.referringSourceId)!.detailLabel!
                }
              >
                <input
                  className={inputCls}
                  value={newPatient.referringSourceDetail}
                  onChange={(e) =>
                    setNewPatient({ ...newPatient, referringSourceDetail: e.target.value })
                  }
                />
              </Field>
            )}
          </div>
          <p className="text-xs text-[var(--muted)]">
            You can complete the rest of these later from the profile.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={btnPrimary}
              disabled={!newPatient.name.trim()}
              onClick={() => void createPatient()}
            >
              Create patient
            </button>
            <button type="button" className={btnSecondary} onClick={backToSearch}>
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
                  type="button"
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
                      type="button"
                      key={p.patientId}
                      className="rounded-full border border-[var(--border)] px-2.5 py-1 text-xs text-[var(--ink)] hover:bg-[var(--paper)]"
                      onClick={() =>
                        void repos.patients
                          .get(p.patientId)
                          .then((full) => full && selectPatientFromSearch(full))
                      }
                    >
                      {p.patientName} <span className="text-[var(--muted)]">{p.mrno}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
          <button type="button" className={btnSecondary} onClick={startCreatingPatient}>
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
          <SearchableSelect
            label="Therapist *"
            value={therapistId}
            onChange={setTherapistId}
            options={(therapists ?? []).map((t) => ({ value: t.id, label: t.name }))}
          />

          <SegmentedToggle
            value={mode}
            onChange={(v) => {
              setMode(v);
              resetBillAdjustment();
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
            <SearchableSelect
              label="Service *"
              value={serviceCatalogId}
              onChange={(v) => {
                setServiceCatalogId(v);
                resetBillAdjustment();
              }}
              options={categories.flatMap(([category, items]) =>
                items.map((i) => ({
                  value: i.id,
                  label: `${i.name} — ${formatINR(i.basePricePaise)}${
                    i.sessionCount > 1
                      ? ` (${i.sessionCount} sessions, ${formatINR(effectivePricePerSession(i))}/session)`
                      : ''
                  }`,
                  group: category,
                }))
              )}
            />
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

          {role === 'front_desk' && !clinicalDetailsExpanded ? (
            <button
              type="button"
              className="justify-self-start text-left text-xs font-medium text-[var(--teal)] hover:underline"
              onClick={() => setClinicalDetailsExpanded(true)}
            >
              + Add condition / treatments (optional)
            </button>
          ) : (
            <>
              <Field label="Condition (this visit)">
                <input
                  className={inputCls}
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                />
              </Field>
              <Field label="Treatments">
                <div className="space-y-2">
                  {treatments.length > 0 && (
                    <MultiToggle
                      options={treatments.map((t) => ({ value: t.id, label: t.name }))}
                      value={treatmentIds}
                      onChange={setTreatmentIds}
                    />
                  )}
                  <input
                    className={inputCls}
                    placeholder="Add something not in the list above…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </Field>
            </>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Billing">
        <div className="grid grid-cols-1 gap-3">
          <BillAdjustmentFields
            catalogPricePaise={catalogPricePaise}
            catalogLabel={
              mode === 'continuation'
                ? 'Package session (catalog)'
                : selectedService
                  ? `Catalog — ${selectedService.name}`
                  : 'Catalog price'
            }
            mode={adjustmentMode}
            valueType={adjustmentValueType}
            value={adjustmentValue}
            reason={adjustmentReason}
            onModeChange={setAdjustmentMode}
            onValueTypeChange={setAdjustmentValueType}
            onValueChange={setAdjustmentValue}
            onReasonChange={setAdjustmentReason}
            continuationSession={mode === 'continuation'}
          />

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
                  { value: 'paid', label: 'Collected now' },
                  { value: 'pending', label: 'Take payment later' },
                ]}
              />
              {paymentChoice === 'paid' ? (
                <>
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
                  {paymentMethod === 'upi' && patient && (
                    <ShowUpiQrButton
                      amountPaise={billPaise}
                      mrno={patient.mrno}
                      visitDate={visitDate}
                      patientName={patient.name}
                    />
                  )}
                </>
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
        </div>
      </SectionCard>

      <ErrorNote message={error} />
      <div className="flex gap-2">
        <button type="button" className={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save visit'}
        </button>
        <button type="button" className={btnSecondary} onClick={goBack}>
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
