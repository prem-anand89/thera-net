import { StartVisitSheet } from '@/components/StartVisitSheet';
import { patientsBackLink, type NewVisitBackTarget } from '@/app/router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
  consultationNoteService,
} from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useSession } from '@/app/useSession';
import { usePermissions } from '@/app/usePermissions';
import { useEntitlements } from '@/app/useEntitlements';
import { VisitCapNotice } from '@/components/VisitCapNotice';
import { formatINR } from '@/domain/money';
import { appointmentSetsTherapist, toLocalDateStr, visitPrefillFromAppointment } from '@/domain/schedule';
import { receivedDateAtVisit } from '@/domain/paymentDates';
import { formatDateDMY } from '@/domain/fiscalYear';
import { findSimilarPatients } from '@/domain/similarPatients';
import { SimilarPatients } from '@/components/SimilarPatients';
import { usePatientDirectory } from '@/components/usePatientDirectory';
import { isNearingCompletion } from '@/domain/packageTracking';
import { rankTreatmentsByUsage } from '@/domain/treatmentUsage';
import {
  type Patient,
  type PaymentMethod,
  type TreatmentItem,
  type UUID,
} from '@/domain/types';
import type { TreatmentUsageRow } from '@/services/dashboardService';
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
import { TakePaymentDialog } from '@/components/TakePaymentDialog';
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
import { PhoneField } from '@/components/PhoneField';
import {
  ServiceRows,
  continuationLine,
  draftLinesToItems,
  draftSubtotalPaise,
  emptyDraftLine,
  hasService,
  isPackageRow,
  rowName,
  rowProblems,
  type DraftLine,
  type OpenPackage,
} from './ServiceRows';
import { adjustmentSurvives, canChangePatient, draftLinesToVisitLines, rowsForNewPatient } from './draftVisit';
import { RevenueShareSummary } from './RevenueShareSummary';
import { VisitSaveBar, type SavePayment } from './VisitSaveBar';

// UPI first — the most common collection method at an Indian clinic front
// desk, so it's both the default (see paymentMethod's useState below) and
// the top option here instead of making staff scroll past Cash every time.
// Stable references for useLiveQuery's loading-state fallback — a fresh
// `?? []` literal on every render would change identity each time and
// defeat the useMemo that ranks treatments by usage.
const EMPTY_TREATMENTS: TreatmentItem[] = [];
const EMPTY_PACKAGES: OpenPackage[] = [];
const EMPTY_TREATMENT_USAGE: TreatmentUsageRow[] = [];

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
  const { canBill, canCollectPayment, role, canViewClinicalNotes: canWriteNotes } = usePermissions();
  const navigate = useNavigate();
  const { session } = useSession();
  const entitlements = useEntitlements(clinic.id);
  const search = useSearch({ strict: false }) as {
    repeatVisitId?: string;
    patientId?: string;
    prefillName?: string;
    prefillPhone?: string;
    appointmentId?: string;
    from?: NewVisitBackTarget;
  };

  // "Done"/"Cancel" return to where the visit was started (`from`: Workspace,
  // Schedule, Ledger, Patients). Without one, a visit opened from a patient's
  // own profile (its "New visit" button, which passes patientId) returns to
  // that patient, and anything else to Workspace.
  function goBack() {
    if (search.from) {
      const target = patientsBackLink(search.from);
      if (target.to === '/ledger' && target.search) {
        void navigate({ to: '/ledger', search: target.search });
      } else {
        void navigate({ to: target.to });
      }
    } else if (search.patientId) {
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
  const [startNoteOpen, setStartNoteOpen] = useState(false);
  const [newPatient, setNewPatient] = useState({
    name: search.prefillName ?? '',
    mrno: '',
    age: '',
    sex: '',
    phone: search.prefillPhone ?? '',
    email: '',
    altPhone: '',
    primaryCondition: '',
    referringSourceId: '',
    referringSourceDetail: '',
  });
  const referringSources =
    useLiveQuery(() => repos.referringSourceCatalog.list(clinic.id), [clinic.id]) ?? [];

  // Visit fields
  // The local calendar day — the UTC date is yesterday from midnight to 5:30 AM in
  // India, which dated an early-morning visit (and its payment) a day back.
  const today = toLocalDateStr(new Date());
  const [visitDate, setVisitDate] = useState(today);
  const [therapistId, setTherapistId] = useState('');
  // The services performed, in order; the first is the visit's main service. One empty row to start.
  const [rows, setRows] = useState<DraftLine[]>(() => [emptyDraftLine()]);
  // Messages from the last Save attempt, by row index (the package rule is checked live by ServiceRows).
  const [rowErrors, setRowErrors] = useState<Map<number, string>>(() => new Map());
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
  // On a phone the Save button is in the fixed bar, far from this message — bring it into view.
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  }, [error]);
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
    billPaise: number;
    visitDate: string;
    mrno: string;
    /** The visit saved but its payment didn't — shown on the saved screen instead of the form, so a retry can't create a second visit. */
    paymentError?: string;
  } | null>(null);
  // Synchronous double-tap guard: `busy` is React state and lags one render.
  const savingRef = useRef(false);
  const [invoicing, setInvoicing] = useState(false);
  const [takingPayment, setTakingPayment] = useState(false);
  // What's been received for the just-saved visit, so Take payment disappears
  // once it's settled (the dialog can be used for part payments too).
  const savedPayments = useLiveQuery(
    () => (justSaved ? repos.payments.listByVisit(justSaved.visitId) : undefined),
    [justSaved?.visitId]
  );
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
  const treatments =
    useLiveQuery(() => repos.treatmentCatalog.list(clinic.id), [clinic.id]) ?? EMPTY_TREATMENTS;
  const treatmentUsage =
    useLiveQuery(() => dashboardService.treatmentUsageCounts(clinic.id), [clinic.id]) ??
    EMPTY_TREATMENT_USAGE;
  const rankedTreatments = useMemo(
    () => rankTreatmentsByUsage(treatments, treatmentUsage),
    [treatments, treatmentUsage]
  );
  const matches = useLiveQuery(
    () => (patient ? Promise.resolve([]) : repos.patients.search(clinic.id, query)),
    [clinic.id, query, patient]
  );
  const allPatients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);

  // Look-alikes of the patient being typed (same phone, or a near-identical name), with what tells
  // people apart. The receptionist must say "Use this patient" or "Different person" before creating.
  const { lastVisitOn } = usePatientDirectory(clinic.id, true);
  const similar = useMemo(
    () => findSimilarPatients(allPatients ?? [], newPatient.name, newPatient.phone),
    [allPatients, newPatient.name, newPatient.phone]
  );
  const similarKey = similar.map((m) => m.patient.id).join(',');
  const [differentKey, setDifferentKey] = useState<string | null>(null);
  const differentConfirmed = similar.length > 0 && differentKey === similarKey;

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

  // Tagged with the patient it was read for: after a patient change the live query can still hold the
  // previous patient's list for a moment, and that must never be mistaken for the new patient's.
  const openPackagesResult = useLiveQuery(async (): Promise<{ patientId: UUID | null; list: OpenPackage[] }> => {
    if (!patient) return { patientId: null, list: [] };
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
    return { patientId: patient.id, list: open.sort((a, b) => b.startedOn.localeCompare(a.startedOn)) };
  }, [clinic.id, patient?.id]);
  const openPackages = useMemo((): OpenPackage[] | undefined => {
    if (!patient) return EMPTY_PACKAGES;
    return openPackagesResult?.patientId === patient.id ? openPackagesResult.list : undefined;
  }, [patient, openPackagesResult]);

  // "Complete visit" from an appointment: the visit is that appointment's — its therapist and its day —
  // not whoever saw the patient last. Applied once per appointment, so a manual change afterwards sticks.
  const fromAppointment = useLiveQuery(
    async () =>
      search.appointmentId
        ? // null = not on this device, so the usual therapist default applies instead of waiting forever.
          ((await repos.appointments.listByClinic(clinic.id)).find((a) => a.id === search.appointmentId) ?? null)
        : undefined,
    [clinic.id, search.appointmentId]
  );
  const appliedAppointmentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!fromAppointment || appliedAppointmentRef.current === fromAppointment.id) return;
    appliedAppointmentRef.current = fromAppointment.id;
    const prefill = visitPrefillFromAppointment(fromAppointment);
    if (prefill.therapistId) setTherapistId(prefill.therapistId);
    setVisitDate(prefill.visitDate);
  }, [fromAppointment]);

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
      // a package continuation this just seeds the plain service before the
      // effect below (once openPackages has loaded) swaps in the matching
      // package session; for an ordinary one-off repeat (no package
      // involved) this IS the whole pre-fill. (Only the main service is
      // repeated, not the visit's other lines.)
      setRows([{ ...emptyDraftLine(), serviceCatalogId: repeatVisit.serviceCatalogId }]);
      // The discount is pre-filled only when the original had one service: against several lines
      // the old amount no longer means the same thing.
      const lineCount = (await repos.visitItems.listByVisitIds([repeatVisit.id])).filter((i) => !i.deleted).length;
      if (lineCount > 1) {
        resetBillAdjustment();
        return;
      }
      const inferred = inferBillAdjustment(
        repeatVisit.catalogPricePaise,
        repeatVisit.actualBillPaise
      );
      setAdjustmentMode(inferred.mode);
      setAdjustmentValueType(inferred.valueType);
      setAdjustmentValue(inferred.value > 0 ? String(inferred.value) : '');
      setAdjustmentReason(repeatVisit.adjustmentReason ?? '');
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
    // An appointment's own therapist wins (see fromAppointment above).
    if (appointmentSetsTherapist(search.appointmentId, fromAppointment)) return;
    // Returning patients default to whoever saw them last. First visits
    // leave the current pick alone — blanking it raced with the user's
    // (or myTherapistId's) selection once Dexie resolved an empty history.
    if (lastVisit?.therapistId) setTherapistId(lastVisit.therapistId);
  }, [patient, patientVisits, lastVisit?.therapistId, search.repeatVisitId, search.appointmentId, fromAppointment]);

  // Once per repeated visit: a later openPackages update must not re-insert a package row the user removed.
  const repeatPackageAppliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!repeatVisit?.packageGroupId || openPackages === undefined) return;
    if (repeatPackageAppliedRef.current === repeatVisit.id) return;
    repeatPackageAppliedRef.current = repeatVisit.id;
    const match = openPackages.find((op) => op.packageGroupId === repeatVisit.packageGroupId);
    // If the package this visit belonged to has since closed (every session
    // logged), the plain repeat of the same service from the effect above
    // stays as it is. Otherwise its next session replaces that row.
    if (match) setRows((prev) => [continuationLine(match, prev[0]?.assistingTherapistId ?? null), ...prev.slice(1)]);
  }, [repeatVisit, openPackages]);

  // The rows belong to one patient, and this effect keeps them in step:
  // - Choosing a different patient (or clearing it) resets the rows and the
  //   discount, so one patient's package session never rides onto the next.
  // - The FIRST patient pick merges: services chosen before any patient stay
  //   (with the discount), and the patient's single open package, if any,
  //   is added as a continuation row (two or more open packages are not
  //   guessed at; the front desk picks in the service picker).
  // - No continuation is added beside a package row that was kept.
  // - It runs once per patient (tracked by id, not by re-deriving "untouched"
  //   state), so removing the package row isn't silently reverted if
  //   openPackages re-emits.
  // - The repeat-visit shortcut fills its own rows and is skipped here.
  const catalogItems = useMemo(() => catalog ?? [], [catalog]);
  const rowsPatientRef = useRef<UUID | null>(null);
  useEffect(() => {
    if (!patient) {
      if (rowsPatientRef.current) {
        rowsPatientRef.current = null;
        setRows([emptyDraftLine()]);
        setRowErrors(new Map());
        resetBillAdjustment();
      }
      return;
    }
    if (repeatVisit && patient.id === repeatVisit.patientId) {
      // The repeat flow fills the rows itself.
      rowsPatientRef.current = patient.id;
      return;
    }
    if (openPackages === undefined || rowsPatientRef.current === patient.id) return;
    // Services picked before any patient stay (and so does the discount); rows that belonged to another
    // patient start over.
    const previousPatientId = rowsPatientRef.current;
    rowsPatientRef.current = patient.id;
    setRows((prev) => rowsForNewPatient(prev, openPackages, previousPatientId, (r) => isPackageRow(r, catalogItems)));
    setRowErrors(new Map());
    if (previousPatientId !== null) resetBillAdjustment();
  }, [patient, repeatVisit, openPackages, catalogItems]);

  // An assistant can't also be the visit's therapist: changing the therapist untags that person.
  useEffect(() => {
    if (!therapistId) return;
    setRows((prev) =>
      prev.some((r) => r.assistingTherapistId === therapistId)
        ? prev.map((r) => (r.assistingTherapistId === therapistId ? { ...r, assistingTherapistId: null } : r))
        : prev
    );
  }, [therapistId]);

  // Default therapist to current user's therapist when creating a new patient
  // or selecting a patient for 'new' mode (unless therapist is already selected)
  useEffect(() => {
    if (!patient || therapistId || !myTherapistId) return;
    setTherapistId(myTherapistId);
  }, [patient, therapistId, myTherapistId]);

  const activeTherapists = useMemo(() => (therapists ?? []).filter((t) => t.active), [therapists]);
  // A solo practitioner (or a clinic with one active therapist) has nobody to assist.
  const showAssistant = clinic.clinicType !== 'individual' && activeTherapists.length > 1;
  const splitEnabled = clinic.enableTherapistSplit !== false;
  const therapistsById = useMemo(
    () => new Map((therapists ?? []).map((t) => [t.id, t])),
    [therapists]
  );

  // The bill: the discount / top-up applies to the rows' catalog total (₹0 for a package session).
  const catalogPricePaise = draftSubtotalPaise(rows, catalogItems);
  const billPaise = computeAdjustedBillPaise(
    catalogPricePaise,
    billAdjustmentFromFields(adjustmentMode, adjustmentValueType, adjustmentValue)
  );
  const adjustmentPaise = billPaise - catalogPricePaise;
  const serviceLabel = rows.filter(hasService).map((r) => rowName(r, catalogItems)).join(' + ') || 'Visit';

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
    const subtotal = draftSubtotalPaise(next, catalogItems);
    if (!adjustmentSurvives(subtotal, adjustmentMode, adjustmentValueType, adjustmentValue)) resetBillAdjustment();
  }

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
    if (similar.length > 0 && !differentConfirmed) {
      return setError('This patient may already be on file. Choose "Use this patient" or "Different person".');
    }
    if (differentConfirmed && (!newPatient.age || !newPatient.sex)) {
      return setError('Add age and sex so this patient can be told apart from the similar one.');
    }
    try {
      const created = await patientService.create({
        clinicId: clinic.id,
        name: newPatient.name,
        mrno: newPatient.mrno || undefined,
        age: newPatient.age ? Number(newPatient.age) : null,
        sex: (newPatient.sex || null) as Patient['sex'],
        phone: newPatient.phone || null,
        email: newPatient.email || null,
        altPhone: newPatient.altPhone || null,
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
    const built = draftLinesToVisitLines(rows, openPackages ?? []);
    if ('errors' in built) {
      setRowErrors(built.errors);
      const onlyEmpty = [...built.errors.values()].every((m) => m === 'Pick a service.');
      return setError(
        !onlyEmpty
          ? 'Fix the service marked above.'
          : rows.length === 1
            ? 'Select a service'
            : 'Pick a service for each row, or remove the empty one.'
      );
    }
    if (rowProblems(rows, catalogItems).size > 0) return setError('Fix the service marked above.');
    if (adjustmentPaise !== 0 && !adjustmentReason.trim()) {
      return setError('Enter a reason for the bill adjustment');
    }
    if (
      entitlements.enforcementEnabled &&
      entitlements.visitCapPerMonth != null &&
      entitlements.visitsThisMonth >= entitlements.visitCapPerMonth
    ) {
      return setError(
        `This clinic's plan allows ${entitlements.visitCapPerMonth} visits per month and ${entitlements.visitsThisMonth} are logged. Nothing you entered is lost. Visits can be saved again next month, or after an upgrade.`
      );
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(true);
    try {
      const visit = await visitService.create({
        clinicId: clinic.id,
        patientId: patient.id,
        therapistId,
        visitDate,
        lines: built.lines,
        condition,
        treatmentNotes: notes,
        treatmentIds,
        actualBillPaise: adjustmentPaise !== 0 ? billPaise : undefined,
        adjustmentReason: adjustmentPaise !== 0 ? adjustmentReason : undefined,
        ...(billPaise > 0 && canCollectPayment && paymentChoice === 'pending'
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
      let paymentError: string | undefined;
      if (billPaise > 0 && canCollectPayment && paymentChoice === 'paid') {
        try {
          await directPaymentService.logPayment(
            clinic.id,
            visit.id,
            billPaise,
            paymentMethod,
            // Cash taken at the visit; a future-dated visit can't have been paid yet.
            receivedDateAtVisit(visitDate, today),
            null
          );
        } catch (paymentFailure) {
          // The visit is already saved. Falling into the outer catch would keep
          // the form open and a second Save would log the same visit again.
          paymentError = toFriendlyMessage(paymentFailure);
        }
      }

      // Slice 5: this visit is arrival for the appointment it was started
      // from ("Create visit" on Requests → Bookings / Workspace's
      // "Expected today") — resolve patient_id/visit_id and flip the
      // appointment to arrived. Doesn't block the save-succeeded screen
      // below on this secondary link; the visit itself already saved.
      if (search.appointmentId) {
        // Queued (and sent after the visit syncs), so this can't fail the save.
        void bookingService
          .linkAppointmentVisit(search.appointmentId, visit.id, patient.id)
          .catch((e) => console.error('Could not queue the appointment link', e));
        // Notes written before the service was chosen join this visit.
        void consultationNoteService
          .linkAppointmentNotesToVisit(clinic.id, patient.id, search.appointmentId, visit.id)
          .catch((e) => console.error('Could not attach earlier notes to this visit', e));
      }

      setJustSaved({
        visitId: visit.id,
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        serviceLabel,
        isPackage: rows.some((r) => r.continuation),
        alreadyCollected: billPaise > 0 && canCollectPayment && paymentChoice === 'paid' && !paymentError,
        paymentError,
        therapistId,
        billPaise,
        visitDate,
        mrno: patient.mrno,
      });
      setFeedbackRequested(false);
      // Clinic policy "always": the bill step opens straight after a paid visit
      // (still the usual review-then-issue dialog, never issued silently).
      if (clinic.invoicePolicy === 'always' && billPaise > 0 && canBill && paymentChoice === 'paid' && !paymentError) {
        setInvoicing(true);
      }
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  if (justSaved) {
    const otherPrimaryShown = clinic.clinicalDocsEnabled || canBill || canCollectPayment;
    // Still owed on this visit (0 without billing access or when settled).
    const paymentDue = canCollectPayment
      ? Math.max(0, justSaved.billPaise - (savedPayments ?? []).reduce((sum, p) => sum + p.amountPaise, 0))
      : 0;
    const invoiceTarget: IssueInvoiceTarget = {
      visitId: justSaved.visitId,
      patientId: justSaved.patientId,
      patientLabel: justSaved.patientName,
      serviceLabel: justSaved.serviceLabel,
      isPackage: justSaved.isPackage,
      // Settled up front, or since (Take payment above).
      alreadyCollected: justSaved.alreadyCollected || (canBill && justSaved.billPaise > 0 && paymentDue === 0),
    };
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <SectionCard title="Visit logged">
          <p className="text-sm text-[var(--ink)]">Visit saved for {justSaved.patientName}.</p>
          {justSaved.paymentError && (
            <div className="mt-3">
              <ErrorNote message={`The visit was saved, but the payment was not recorded: ${justSaved.paymentError} Use Take payment to record it.`} />
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {paymentDue > 0 && (
              <button type="button" className={btnPrimary} onClick={() => setTakingPayment(true)}>
                Take payment · {formatINR(paymentDue)}
              </button>
            )}
            {canBill && (
              <button
                type="button"
                className={paymentDue > 0 ? btnSecondary : btnPrimary}
                onClick={() => setInvoicing(true)}
              >
                Give bill
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
                void navigate({
                  to: '/visits/new',
                  search: { patientId: justSaved.patientId, ...(search.from ? { from: search.from } : {}) },
                });
              }}
            >
              Log a separate visit for {justSaved.patientName}
            </button>
            <button type="button" className={btnSecondary} onClick={goBack}>
              Done
            </button>
          </div>
        </SectionCard>
        {takingPayment && (
          <TakePaymentDialog
            clinicId={clinic.id}
            visitId={justSaved.visitId}
            invoiceId={null}
            amountPaise={justSaved.billPaise}
            visitDate={justSaved.visitDate}
            patientLabel={justSaved.patientName}
            mrno={justSaved.mrno}
            patientId={justSaved.patientId}
            onClose={() => setTakingPayment(false)}
          />
        )}
        {invoicing && (
          <IssueInvoiceDialog
            clinicId={clinic.id}
            target={invoiceTarget}
            onClose={() => setInvoicing(false)}
            returnTo={search.from ?? '/workspace'}
          />
        )}
      </div>
    );
  }

  const savePayment: SavePayment =
    billPaise > 0 && canCollectPayment
      ? paymentChoice === 'paid'
        ? { kind: 'now', methodLabel: PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.label ?? '' }
        : { kind: 'later' }
      : { kind: 'none' };

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

          {clinic.clinicalDocsEnabled && canWriteNotes && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--teal-light)] px-3 py-2 text-sm text-[var(--ink)]">
              <span>Not ready to pick a service?</span>
              <button
                type="button"
                className="font-medium text-[var(--teal)] hover:underline"
                onClick={() => {
                  if (search.appointmentId) {
                    const appointmentId = search.appointmentId;
                    void bookingService.markAppointmentArrived(appointmentId).catch(() => undefined);
                    void navigate({
                      to: '/patients/$patientId/notes/new',
                      params: { patientId: patient.id },
                      search: { appointmentId },
                    });
                  } else {
                    setStartNoteOpen(true);
                  }
                }}
              >
                Start a note first — add the service later →
              </button>
            </div>
          )}
          <StartVisitSheet open={startNoteOpen} initialPatientId={patient.id} returnTo={search.from} onClose={() => setStartNoteOpen(false)} />

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
                  {isNearingCompletion(openPackages[0].logged, openPackages[0].packageTotal) && (
                    <Pill tone="amber">Renew soon</Pill>
                  )}
                  <span className="text-xs text-[var(--muted)]">
                    started {formatDateDMY(openPackages[0].startedOn)}
                  </span>
                </div>
              ) : (
                <span className="text-[var(--muted)]">No open package</span>
              )}
            </SummaryTile>
          )}

          {canChangePatient(search) && (
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
            <Field label="Phone" htmlFor="new-visit-phone">
              <PhoneField
                id="new-visit-phone"
                placeholder="Recommended"
                value={newPatient.phone}
                onChange={(phone) => setNewPatient({ ...newPatient, phone })}
              />
            </Field>
            <SimilarPatients
              matches={similar}
              lastVisitOn={lastVisitOn}
              differentConfirmed={differentConfirmed}
              onUse={(p) => {
                selectPatientFromSearch(p);
                setCreatingPatient(false);
              }}
              onDifferent={() => setDifferentKey(similarKey)}
            />
            {!newPatient.phone.trim() && (
              <p className="text-xs text-[var(--muted)]">
                No phone on file — fine for a walk-in with none, but it limits later search and
                duplicate checks.
              </p>
            )}
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
            <details className="rounded-lg border border-[var(--border)] px-3 py-2" open={Boolean(newPatient.email || newPatient.altPhone || newPatient.mrno)}>
              <summary className="cursor-pointer text-sm font-medium text-[var(--ink)]">
                More details <span className="font-normal text-[var(--muted)]">(optional)</span>
              </summary>
              <div className="mt-3 grid grid-cols-1 gap-3">
                <Field label="Email">
                  <input
                    type="email"
                    className={inputCls}
                    value={newPatient.email}
                    onChange={(e) => setNewPatient({ ...newPatient, email: e.target.value })}
                  />
                </Field>
                <Field label="Alternate phone" htmlFor="new-visit-alt-phone">
                  <PhoneField
                    id="new-visit-alt-phone"
                    placeholder="Family member, landline…"
                    value={newPatient.altPhone}
                    onChange={(altPhone) => setNewPatient({ ...newPatient, altPhone })}
                  />
                </Field>
                <Field label="Patient ID">
                  <input
                    className={inputCls}
                    placeholder="Leave blank to auto-generate"
                    value={newPatient.mrno}
                    onChange={(e) => setNewPatient({ ...newPatient, mrno: e.target.value })}
                  />
                </Field>
                <p className="text-xs text-[var(--muted)]">Use Patient ID only to keep a number from old records.</p>
              </div>
            </details>
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
            placeholder="Search ID, name or phone…"
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
                  <input
                    className={inputCls}
                    placeholder="Anything not in the list…"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>
              </Field>
            </>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Services">
        <div className="grid grid-cols-1 gap-3">
          <ServiceRows
            rows={rows}
            onChange={changeRows}
            catalog={catalogItems}
            openPackages={openPackages ?? []}
            therapists={therapists ?? []}
            primaryId={therapistId}
            showAssistant={showAssistant}
            errors={rowErrors}
            patientName={patient?.name}
          />

          {/* The rows are the itemised bill: subtotal, the discount / top-up, then the total. The
              discount survives row edits and is off while there is nothing to discount. */}
          <BillAdjustmentFields
            catalogPricePaise={catalogPricePaise}
            catalogLabel="Subtotal"
            totalLabel="Total"
            disabled={catalogPricePaise === 0}
            mode={adjustmentMode}
            valueType={adjustmentValueType}
            value={adjustmentValue}
            reason={adjustmentReason}
            onModeChange={setAdjustmentMode}
            onValueTypeChange={setAdjustmentValueType}
            onValueChange={setAdjustmentValue}
            onReasonChange={setAdjustmentReason}
          />

          {showAssistant && (
            <RevenueShareSummary
              items={draftLinesToItems(rows, catalogItems)}
              primaryId={therapistId}
              billPaise={billPaise}
              therapistsById={therapistsById}
              splitEnabled={splitEnabled}
            />
          )}

          {billPaise > 0 && !canCollectPayment && (
            <p className="text-xs text-[var(--muted)]">
              This visit will be saved as unbilled — billing is handled separately at this clinic.
            </p>
          )}
        </div>
      </SectionCard>

      {billPaise > 0 && canCollectPayment && (
        <div id="visit-payment" className="scroll-mt-24">
          <SectionCard title="Payment">
            <div>
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
            </div>
          </SectionCard>
        </div>
      )}

      <div ref={errorRef}>
        <ErrorNote message={error} />
      </div>
      <div className="flex gap-2">
        {/* Phones save from the fixed bar below; tablet and up keep Save here, under Payment. */}
        <button type="button" className={`${btnPrimary} hidden sm:inline-flex`} disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save visit'}
        </button>
        <button type="button" className={btnSecondary} onClick={goBack}>
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    // Phones get extra bottom room so the fixed save bar never covers the Payment card or the last field.
    <div className="mx-auto max-w-4xl space-y-4 pb-24 sm:pb-0">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)]">New visit</h1>
      <VisitCapNotice />

      {/* Same two-column shape (reference panel left, form right) whether or
          not a patient is picked yet — the *content* inside the left panel
          changes (search/create UI vs. confirmed-patient tiles), but the
          page's own structure doesn't, so picking a patient doesn't cause a
          jarring column-count/width jump. Collapses to stacked below tab:. */}
      <div className="tab:flex tab:items-start tab:gap-4">
        <div className="tab:w-80 tab:shrink-0">{patientPanel}</div>
        <div className="mt-4 min-w-0 flex-1 tab:mt-0">{visitPanel}</div>
      </div>

      <VisitSaveBar
        totalPaise={billPaise}
        serviceCount={rows.filter(hasService).length}
        payment={savePayment}
        busy={busy}
        onSave={() => void save()}
        onSummaryClick={() =>
          document.getElementById('visit-payment')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
        }
      />

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
