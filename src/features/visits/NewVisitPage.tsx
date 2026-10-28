import { IconChevronLeft, IconPen } from '@/components/StatIcons';
import { StartVisitSheet } from '@/components/StartVisitSheet';
import { patientsBackLink, type NewVisitBackTarget } from '@/app/router';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBlocker, useNavigate, useSearch } from '@tanstack/react-router';
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
import { packageSessionShares } from '@/domain/payBase';
import { packageMoveNote as buildPackageMoveNote } from './packageMoveNote';
import { appointmentSetsTherapist, toLocalDateStr, visitPrefillFromAppointment } from '@/domain/schedule';
import { receivedDateAtVisit } from '@/domain/paymentDates';
import { formatDateDMY } from '@/domain/fiscalYear';
import { findSimilarPatients } from '@/domain/similarPatients';
import { SimilarPatients } from '@/components/SimilarPatients';
import { usePatientDirectory } from '@/components/usePatientDirectory';
import { rankTreatmentsByUsage } from '@/domain/treatmentUsage';
import { rankServicesByUsage } from '@/domain/serviceUsage';
import {
  type Patient,
  type PaymentMethod,
  type TreatmentItem,
  type UUID,
} from '@/domain/types';
import type { ServiceUsageCountRow, TreatmentUsageRow } from '@/services/dashboardService';
import { toFriendlyMessage } from '@/lib/errors';
import {
  Field,
  inputCls,
  btnPrimary,
  btnSecondary,
  ErrorNote,
  SectionCard,
  Pill,
  MultiToggle,
  ConfirmDialog,
} from '@/components/ui';
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
  newDraftKey,
  hasService,
  isPackageRow,
  rowName,
  rowProblems,
  type DraftLine,
  type OpenPackage,
} from './ServiceRows';
import { adjustmentSurvives, canChangePatient, CHOOSE_A_SERVICE, lastFinishedPackage, shouldFoldTreatments, visibleTreatmentOptions, draftLinesToVisitLines, lastPackageShare, rowsForNewPatient } from './draftVisit';
import { RevenueShareSummary } from './RevenueShareSummary';
import { PickerMenu } from './PickerMenu';
import { therapistColor } from '@/components/schedule/scheduleColors';
import { patientDue } from '@/domain/patientDue';
import { formatINR } from '@/domain/money';
import { treatmentsDisplayText } from '@/components/visit/formatters';
import { PaymentMethodChips } from './PaymentMethodChips';
import { VisitLoggedCard, type SavedVisitInfo } from './VisitLoggedCard';
import { visitPermissions } from './visitPermissions';
import { EditVisitModal } from './EditVisitModal';
import { visitDateHint } from './visitDateHint';
import { defaultPaymentMethod, paymentMethodOptions, readLastPaymentMethod, rememberPaymentMethod } from '@/domain/paymentMethods';

// UPI first — the most common collection method at an Indian clinic front
// desk, so it's both the default (see paymentMethod's useState below) and
// the top option here instead of making staff scroll past Cash every time.
// Stable references for useLiveQuery's loading-state fallback — a fresh
// `?? []` literal on every render would change identity each time and
// defeat the useMemo that ranks treatments by usage.
const EMPTY_TREATMENTS: TreatmentItem[] = [];
const EMPTY_PACKAGES: OpenPackage[] = [];
const EMPTY_TREATMENT_USAGE: TreatmentUsageRow[] = [];
const EMPTY_SERVICE_USAGE: ServiceUsageCountRow[] = [];


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
    <div className="flex w-full rounded-md border border-[var(--border)] p-0.5 text-xs sm:w-auto sm:inline-flex">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={opt.disabled}
          aria-pressed={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={`h-8 flex-1 whitespace-nowrap rounded px-3 text-center font-medium transition-colors ${
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

/**
 * Formats a subtle subtitle for patient search results (e.g. "••••4821 · 34y").
 * Omits any missing parts with no stray separators.
 */
export function formatPatientSearchResultSubtitle(patient: Pick<Patient, 'phone' | 'age'>): string {
  const parts: string[] = [];
  const digits = patient.phone ? patient.phone.replace(/\D/g, '') : '';
  if (digits.length >= 4) {
    parts.push(`••••${digits.slice(-4)}`);
  } else if (digits.length > 0) {
    parts.push(digits);
  }
  if (patient.age != null) {
    parts.push(`${patient.age}y`);
  }
  return parts.join(' · ');
}

/** What is still owed on a just-saved visit. Nothing when it was collected on the form, whatever the payments query has read so far. */
export function paymentStillDue(i: {
  canCollect: boolean;
  alreadyCollected: boolean;
  billPaise: number;
  receivedPaise: number;
}): number {
  if (!i.canCollect || i.alreadyCollected) return 0;
  return Math.max(0, i.billPaise - i.receivedPaise);
}

export interface NewVisitSignatureInput {
  rows: DraftLine[];
  patientId: string | null;
  creatingPatient: boolean;
  newPatientName: string;
  condition: string;
  notes: string;
  pendingNote: string;
  treatmentIds: string[];
  adjustmentMode: BillAdjustmentMode;
  location?: 'clinic' | 'home';
}

/** Everything the person can change on the form, as one string, so "changed" means "different from where it started". */
export function newVisitSignature(input: NewVisitSignatureInput): string {
  return JSON.stringify({
    rows: input.rows.map((r) => [
      r.continuation?.packageGroupId ?? r.serviceCatalogId ?? '',
      r.assistingTherapistId ?? '',
      r.sessionShare ? `${r.sessionShare.therapistId}:${r.sessionShare.pct}` : '',
    ]),
    patientId: input.patientId ?? '',
    newPatient: input.creatingPatient ? input.newPatientName.trim() : '',
    condition: input.condition.trim(),
    notes: input.notes.trim(),
    pendingNote: input.pendingNote.trim(),
    treatmentIds: [...input.treatmentIds].sort(),
    adjustmentMode: input.adjustmentMode,
    location: input.location ?? 'clinic',
  });
}

/**
 * Whether leaving would lose something the person did. The form starts out filled in by the page itself
 * (a patient from the link, an open package's session, a repeated visit's services, an appointment's name):
 * that is never "unsaved work". The baseline follows those changes until the person first touches the form
 * (`touched`), then freezes; dirty means touched AND different from that baseline. Saved is never dirty.
 */
export function isNewVisitDirty(input: {
  justSaved: boolean;
  touched: boolean;
  signature: string;
  baseline: string;
}): boolean {
  return !input.justSaved && input.touched && input.signature !== input.baseline;
}

export function NewVisitPage() {
  const clinic = useClinic();
  const { canBill, canCollectPayment, role, isAdmin, canViewClinicalNotes: canWriteNotes } = usePermissions();
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
  const backLabel =
    search.from === '/schedule'
      ? 'Schedule'
      : search.from === '/ledger'
        ? 'Ledger'
        : search.from === '/patients'
          ? 'Patients'
          : 'Workspace';

  function requestExit() {
    if (isDirtyRef.current) {
      setDiscardOpen(true);
    } else {
      goBack();
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
  const [location, setLocation] = useState<'clinic' | 'home'>('clinic');
  const [customConditionOpen, setCustomConditionOpen] = useState(false);
  // The services performed, in order; the first is the visit's main service. One empty row to start.
  const [rows, setRows] = useState<DraftLine[]>(() => [emptyDraftLine()]);
  // Messages from the last Save attempt, by row index (the package rule is checked live by ServiceRows).
  const [rowErrors, setRowErrors] = useState<Map<number, string>>(() => new Map());
  // Set by a Save attempt so ServiceRows shows every row problem (a share added but left without a %).
  const [revealRowProblems, setRevealRowProblems] = useState(false);
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
  // Treatments folds to one summary line once, when a service is chosen after something was ticked or typed. Never
  // while it is being edited, and not again once the person re-opens it (Edit) — their choice then stands.
  const [treatmentsOpen, setTreatmentsOpen] = useState(true);
  const [showAllTreatments, setShowAllTreatments] = useState(false);
  const foldedOnceRef = useRef(false);
  const prevServicesRef = useRef(0);
  const [paymentChoice, setPaymentChoice] = useState<'paid' | 'pending'>('paid');
  const paymentMethods = paymentMethodOptions(clinic);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(() =>
    defaultPaymentMethod(clinic, readLastPaymentMethod(clinic.id))
  );
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
  const [justSaved, setJustSaved] = useState<SavedVisitInfo | null>(null);
  // Synchronous double-tap guard: `busy` is React state and lags one render.
  const savingRef = useRef(false);

  // See isNewVisitDirty: the baseline tracks the page's own prefill until the first touch, then freezes.
  const signature = newVisitSignature({
    rows,
    patientId: patient?.id ?? null,
    creatingPatient,
    newPatientName: newPatient.name,
    condition,
    notes,
    pendingNote,
    treatmentIds,
    adjustmentMode,
    location,
  });
  const touchedRef = useRef(false);
  const baselineRef = useRef(signature);
  if (!touchedRef.current) baselineRef.current = signature;
  const isDirty = isNewVisitDirty({
    justSaved: Boolean(justSaved),
    touched: touchedRef.current,
    signature,
    baseline: baselineRef.current,
  });

  const isDirtyRef = useRef(false);
  isDirtyRef.current = isDirty;
  const blocker = useBlocker({
    shouldBlockFn: () => isDirtyRef.current,
    withResolver: true,
    enableBeforeUnload: () => isDirtyRef.current,
  });
  const [discardOpen, setDiscardOpen] = useState(false);
  const [invoicing, setInvoicing] = useState(false);
  const [takingPayment, setTakingPayment] = useState(false);
  const [editingVisit, setEditingVisit] = useState(false);
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
  const serviceUsage =
    useLiveQuery(() => dashboardService.serviceUsageCounts(clinic.id), [clinic.id]) ??
    EMPTY_SERVICE_USAGE;
  const rankedTreatments = useMemo(
    () => rankTreatmentsByUsage(treatments, treatmentUsage),
    [treatments, treatmentUsage]
  );
  const quickServices = useMemo(
    () => rankServicesByUsage(catalog ?? [], serviceUsage, 3),
    [catalog, serviceUsage]
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
    const activeIds = new Set((await repos.therapists.list(clinic.id)).filter((t) => t.active).map((t) => t.id));
    const sessionLines = await repos.visitItems.listByVisitIds(visits.filter((v) => v.packageGroupId).map((v) => v.id));
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
        purchaseVisitId: sorted[0].id,
        lastShare: lastPackageShare(group, sessionLines, (id) => activeIds.has(id)),
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
  const lastActiveTherapistId = useMemo(
    () => (lastVisit && therapists?.some((t) => t.id === lastVisit.therapistId) ? lastVisit.therapistId : undefined),
    [lastVisit, therapists]
  );
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
  // The open package's own paid status, from the visit it was bought on (sessions after it are ₹0, so the
  // last visit alone never says whether the package itself was paid for).
  const packagePurchase = useMemo(
    () => (patientVisits ?? []).find((v) => v.id === openPackages?.[0]?.purchaseVisitId),
    [patientVisits, openPackages]
  );
  const packagePayments = useLiveQuery(
    () => (packagePurchase ? repos.payments.listByVisit(packagePurchase.id) : undefined),
    [packagePurchase?.id]
  );
  const packageInvoice = useLiveQuery(
    () => (packagePurchase?.invoiceId ? repos.invoices.get(packagePurchase.invoiceId) : undefined),
    [packagePurchase?.invoiceId]
  );
  const packageBadge = useMemo(() => {
    if (!packagePurchase || packagePurchase.actualBillPaise <= 0 || packagePayments === undefined) return null;
    const collected = packagePayments.reduce((sum, p) => sum + p.amountPaise, 0);
    const state = computeVisitPaymentState(
      packagePurchase.actualBillPaise,
      packagePurchase.invoiceId,
      collected,
      packagePurchase.invoiceId ? statusByInvoiceId.get(packagePurchase.invoiceId) : undefined
    );
    return paymentBadge({
      state,
      billPaise: packagePurchase.actualBillPaise,
      collectedPaise: collected,
      visitDate: packagePurchase.visitDate,
      issuedAt: packageInvoice?.issuedAt,
    });
  }, [packagePurchase, packagePayments, packageInvoice, statusByInvoiceId]);
  // What was done at the last visit: the treatments ticked (including ones since retired) and any free-text notes.
  // What this patient still owes, from their own visits — shown as one quiet line in the patient card.
  const patientPaid = useLiveQuery(async () => {
    if (!patient) return new Map<string, number>();
    const ids = new Set((patientVisits ?? []).map((v) => v.id));
    const paid = new Map<string, number>();
    for (const pay of await repos.payments.list(clinic.id)) {
      if (ids.has(pay.visitId)) paid.set(pay.visitId, (paid.get(pay.visitId) ?? 0) + pay.amountPaise);
    }
    return paid;
  }, [clinic.id, patient?.id, patientVisits]);
  const patientBalance = useMemo(
    () => (patientVisits && patientPaid ? patientDue(patientVisits, patientPaid, statusByInvoiceId) : null),
    [patientVisits, patientPaid, statusByInvoiceId]
  );
  // Everyone, retired therapists included: the last visit names who did it, even if they have since left.
  const allTherapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const finishedPackage = useMemo(() => lastFinishedPackage(patientVisits ?? []), [patientVisits]);
  const allTreatments = useLiveQuery(() => repos.treatmentCatalog.list(clinic.id, true), [clinic.id]);
  const chosenCount = useMemo(() => rows.filter(hasService).length, [rows]);
  const hasTreatmentInfo = treatmentIds.length > 0 || notes.trim() !== '';
  useEffect(() => {
    const previousServiceCount = prevServicesRef.current;
    prevServicesRef.current = chosenCount;
    if (
      shouldFoldTreatments({
        previousServiceCount,
        serviceCount: chosenCount,
        hasTreatmentInfo,
        foldedOnce: foldedOnceRef.current,
      })
    ) {
      foldedOnceRef.current = true;
      setTreatmentsOpen(false);
    }
  }, [chosenCount, hasTreatmentInfo]);
  // A different patient starts a fresh form: treatments open again, ready to fold once.
  useEffect(() => {
    foldedOnceRef.current = false;
    setTreatmentsOpen(true);
    setShowAllTreatments(false);
  }, [patient?.id]);
  const lastVisitTreatments = useMemo(() => {
    if (!lastVisit) return '';
    const nameById = new Map((allTreatments ?? []).map((t) => [t.id, t.name]));
    const names = (lastVisit.treatmentIds ?? []).map((id) => nameById.get(id)).filter((n): n is string => Boolean(n));
    const text = treatmentsDisplayText(names, lastVisit.treatmentNotes);
    return text === '—' ? '' : text;
  }, [lastVisit, allTreatments]);
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
    // Only someone still active: a therapist who has left isn't in the list, so the field would look empty
    // while the visit was credited to them.
    if (lastActiveTherapistId) setTherapistId(lastActiveTherapistId);
  }, [patient, patientVisits, lastActiveTherapistId, search.repeatVisitId, search.appointmentId, fromAppointment]);

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

  // A package session run by someone other than the biller moves that session's share to the runner
  // (package attribution). Say so while logging, so the therapist sees the consequence.
  const continuationRow = rows.find((r) => r.continuation);
  const continuationGroupId = continuationRow?.continuation?.packageGroupId ?? null;
  const packageMove = useLiveQuery(async () => {
    if (!continuationGroupId || !splitEnabled) return null;
    const group = await repos.visits.listByPackageGroup(continuationGroupId);
    if (group.length === 0) return null;
    const ids = group.map((g) => g.id);
    const [lines, credits] = await Promise.all([
      repos.visitItems.listByVisitIds(ids),
      repos.visitCredits.listByVisitIds(ids),
    ]);
    const byVisit = <T extends { visitId: string }>(list: T[]) => {
      const m = new Map<string, T[]>();
      for (const x of list) m.set(x.visitId, [...(m.get(x.visitId) ?? []), x]);
      return m;
    };
    const r = packageSessionShares(group, { items: byVisit(lines), credits: byVisit(credits), splitEnabled });
    return r.billerId ? { billerId: r.billerId, amountPaise: r.postTaxPaise } : null;
  }, [continuationGroupId, splitEnabled]);
  const runnerId = continuationRow ? (continuationRow.assistingTherapistId ?? therapistId) : '';
  const helperShare = continuationRow?.sessionShare ?? null;
  const packageMoveNote =
    packageMove && runnerId
      ? buildPackageMoveNote({
          amountPaise: packageMove.amountPaise,
          biller: { id: packageMove.billerId, name: therapistsById.get(packageMove.billerId)?.name ?? 'the biller' },
          runner: { id: runnerId, name: therapistsById.get(runnerId)?.name ?? 'the therapist' },
          helper: helperShare
            ? {
                id: helperShare.therapistId,
                name: therapistsById.get(helperShare.therapistId)?.name ?? 'a colleague',
                pct: helperShare.pct,
              }
            : null,
        })
      : null;

  // The bill: the discount / top-up applies to the rows' catalog total (₹0 for a package session).
  const catalogPricePaise = draftSubtotalPaise(rows, catalogItems);
  const billPaise = computeAdjustedBillPaise(
    catalogPricePaise,
    billAdjustmentFromFields(adjustmentMode, adjustmentValueType, adjustmentValue)
  );
  const adjustmentPaise = billPaise - catalogPricePaise;
  const serviceLabel = rows.filter(hasService).map((r) => rowName(r, catalogItems)).join(' + ') || 'Visit';

  const dateHint = visitDateHint(visitDate, today);
  const servicesChosen = rows.filter(hasService).length;

  const visitDateLabel = useMemo(() => {
    const [y, m, d] = visitDate.split('-').map(Number);
    if (!y || !m || !d) return visitDate;
    const shortDate = new Date(y, m - 1, d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    if (visitDate === today) return `Today, ${shortDate}`;
    if (dateHint?.text === 'Yesterday') return `Yesterday, ${shortDate}`;
    return `${shortDate} '${String(y).slice(-2)}`;
  }, [visitDate, today, dateHint]);

  const knownConditions = useMemo(() => {
    const map = new Map<string, string>();
    const add = (raw: string | undefined | null) => {
      const trimmed = raw?.trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (!map.has(key)) {
        map.set(key, trimmed);
      } else {
        const existing = map.get(key)!;
        // Prefer Title Case over ALL-CAPS or weird "ANkle" caps
        if (/[A-Z]{2,}/.test(existing) && !/[A-Z]{2,}/.test(trimmed)) {
          map.set(key, trimmed);
        }
      }
    };
    add(patient?.primaryCondition);
    (patientVisits ?? []).forEach((v) => add(v.condition));
    return Array.from(map.values());
  }, [patient?.primaryCondition, patientVisits]);

  const treatmentNameById = useMemo(
    () => new Map((allTreatments ?? treatments).map((t) => [t.id, t.name])),
    [allTreatments, treatments]
  );

  const hasPackageInCart = useMemo(() => {
    return rows.some((r) => {
      const cat = catalogItems.find((c) => c.id === r.serviceCatalogId);
      return Boolean(cat && cat.sessionCount > 1);
    });
  }, [rows, catalogItems]);

  const footerSummaryLine = useMemo(() => {
    if (servicesChosen === 0) return null;
    const activeRows = rows.filter((r) => Boolean(r.serviceCatalogId || r.continuation));
    const hasMultiple = activeRows.length > 1;
    const hasContinuation = activeRows.some((r) => r.continuation);
    const serviceNames = activeRows.map((r) => {
      const cat = catalogItems.find((c) => c.id === r.serviceCatalogId);
      const rawName = r.continuation?.serviceName ?? cat?.name ?? 'Service';
      const cleanName = rawName.replace(/\s+Therapy/i, '').trim() || rawName;
      if (r.continuation) {
        return `${cleanName} Pkg ₹0`;
      }
      if (hasMultiple && hasContinuation && cat) {
        return `${cleanName} ${formatINR(cat.pricePaise)}`;
      }
      return cleanName;
    });
    const servicesTitle = serviceNames.join(' + ') || 'Service';

    const selectedTreatmentNames = treatmentIds
      .map((id) => treatmentNameById.get(id))
      .filter((n): n is string => Boolean(n));
    let treatmentsLabel = '';
    if (selectedTreatmentNames.length === 1) {
      treatmentsLabel = ` · ${selectedTreatmentNames[0]}`;
    } else if (selectedTreatmentNames.length > 1) {
      treatmentsLabel = ` · ${selectedTreatmentNames.length} treatments`;
    }

    const hasAdjustment = adjustmentMode !== 'none' && billPaise !== catalogPricePaise;

    if (!hasAdjustment) {
      const countLabel = `${servicesChosen} ${servicesChosen === 1 ? 'service' : 'services'}`;
      return {
        hasAdjustment: false,
        text: `${countLabel} · ${servicesTitle}${treatmentsLabel}`,
      };
    }

    const subtotalFormatted = formatINR(catalogPricePaise);
    const diffFormatted = formatINR(Math.abs(catalogPricePaise - billPaise));
    const isDiscount = adjustmentMode === 'discount';
    const sign = isDiscount ? '−' : '+';
    const modeLabel = isDiscount ? 'discount' : 'extra';

    let reasonPart = '';
    if (adjustmentValueType === 'percent' && adjustmentValue && adjustmentReason) {
      reasonPart = ` (${adjustmentValue}% · ${adjustmentReason})`;
    } else if (adjustmentValueType === 'percent' && adjustmentValue) {
      reasonPart = ` (${adjustmentValue}%)`;
    } else if (adjustmentReason) {
      reasonPart = ` (${adjustmentReason})`;
    }

    return {
      hasAdjustment: true,
      subtotalFormatted,
      servicesTitle,
      sign,
      diffFormatted,
      modeLabel,
      reasonPart,
    };
  }, [
    servicesChosen,
    rows,
    catalogItems,
    treatmentIds,
    treatmentNameById,
    adjustmentMode,
    billPaise,
    catalogPricePaise,
    adjustmentValueType,
    adjustmentValue,
    adjustmentReason,
  ]);

  /**
   * Back to a blank visit after "Visit logged". Date, therapist and payment method stay (back-to-back entry);
   * everything the last visit filled in goes. `touchedRef` is cleared so the unsaved-changes guard measures
   * from this blank form, not from the one the page opened with (which made a fresh form look edited).
   */
  function startFreshVisitForm() {
    setRows([emptyDraftLine()]);
    setRowErrors(new Map());
    setCondition('');
    setNotes('');
    setPendingNote('');
    setTreatmentIds([]);
    setPaymentChoice('paid');
    setLocation('clinic');
    setCustomConditionOpen(false);
    setError(null);
    setFeedbackRequested(false);
    resetBillAdjustment();
    touchedRef.current = false;
    setJustSaved(null);
  }

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
    if (busy) return;
    setBusy(true);
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
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(null);
    if (!patient) return setError('Choose a patient first, or add a new one.');
    if (!therapistId || !therapists?.some((t) => t.id === therapistId)) return setError('Choose who treated the patient.');
    const built = draftLinesToVisitLines(rows, openPackages ?? []);
    if ('errors' in built) {
      setRowErrors(built.errors);
      const onlyEmpty = [...built.errors.values()].every((m) => m === CHOOSE_A_SERVICE);
      return setError(
        !onlyEmpty
          ? 'Check the service marked in red.'
          : rows.length === 1
            ? 'Choose a service.'
            : 'Choose a service for each row, or remove the empty one.'
      );
    }
    if (rowProblems(rows, catalogItems).size > 0) {
      setRevealRowProblems(true);
      return setError('Check the service marked in red.');
    }
    if (adjustmentPaise !== 0 && !adjustmentReason.trim()) {
      return setError('Add a reason for the discount or extra.');
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
        location,
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
          rememberPaymentMethod(clinic.id, paymentMethod);
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

      // Check if this visit was continuing an open package or purchasing a multi-session package
      const continuationRow = rows.find((r) => r.continuation);
      let packageSessionNumber: number | undefined;
      let packageTotalSessions: number | undefined;
      if (continuationRow?.continuation) {
        packageSessionNumber = continuationRow.continuation.logged + 1;
        packageTotalSessions = continuationRow.continuation.packageTotal;
      } else {
        const pkgRow = rows.find((r) => {
          const cat = catalogItems.find((c) => c.id === r.serviceCatalogId);
          return Boolean(cat && cat.sessionCount > 1);
        });
        if (pkgRow) {
          const cat = catalogItems.find((c) => c.id === pkgRow.serviceCatalogId);
          if (cat) {
            packageSessionNumber = 1;
            packageTotalSessions = cat.sessionCount;
          }
        }
      }

      setJustSaved({
        visitId: visit.id,
        patientId: patient.id,
        patientName: patient.name,
        patientPhone: patient.phone,
        serviceLabel,
        isPackage: Boolean(packageSessionNumber) || rows.some((r) => r.continuation),
        packageSessionNumber,
        packageTotalSessions,
        alreadyCollected: billPaise > 0 && canCollectPayment && paymentChoice === 'paid' && !paymentError,
        byPartner: billPaise > 0 && canCollectPayment && paymentChoice === 'paid' && paymentMethod === 'partner' && !paymentError,
        paymentError,
        collectedLabel: paymentMethods.find((m) => m.value === paymentMethod)?.label,
        therapistId,
        billPaise,
        visitDate,
        mrno: patient.mrno,
      });
      setFeedbackRequested(false);
      // Clinic policy "always": the bill step opens straight after a paid visit
      // (still the usual review-then-issue dialog, never issued silently).
      if (clinic.invoicePolicy === 'always' && billPaise > 0 && canBill && paymentChoice === 'paid' && paymentMethod !== 'partner' && !paymentError) {
        setInvoicing(true);
      }
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  }

  // Global keyboard shortcut: Cmd+Enter or Ctrl+Enter saves the visit
  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (!busy && !savingRef.current && servicesChosen > 0) {
          e.preventDefault();
          void saveRef.current();
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, servicesChosen]);

  if (justSaved) {
    // Still owed on this visit (0 without billing access or when settled).
    // Collected on the form: nothing is owed, even in the moment before the payments query answers
    // (it reads empty first, which used to flash "Take payment" for a visit that was already paid).
    const paymentDue = paymentStillDue({
      canCollect: canCollectPayment,
      alreadyCollected: justSaved.alreadyCollected,
      billPaise: justSaved.billPaise,
      receivedPaise: (savedPayments ?? []).reduce((sum, p) => sum + p.amountPaise, 0),
    });
    const invoiceTarget: IssueInvoiceTarget = {
      visitId: justSaved.visitId,
      patientId: justSaved.patientId,
      patientLabel: justSaved.patientName,
      serviceLabel: justSaved.serviceLabel,
      isPackage: justSaved.isPackage,
      // Settled up front, or since (Take payment above).
      alreadyCollected: justSaved.alreadyCollected || (canBill && justSaved.billPaise > 0 && paymentDue === 0),
    };
    const showBill = canBill && !justSaved.byPartner;
    const therapistName = therapistsById.get(justSaved.therapistId)?.name;
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <VisitLoggedCard
          justSaved={justSaved}
          therapistName={therapistName}
          paymentDue={paymentDue}
          canBill={showBill}
          clinicalDocsEnabled={Boolean(clinic.clinicalDocsEnabled)}
          enablePatientComms={Boolean(clinic.enablePatientComms)}
          feedbackRequested={feedbackRequested}
          onRequestFeedback={() => {
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
          onTakePayment={() => setTakingPayment(true)}
          onGiveBill={() => setInvoicing(true)}
          onEdit={
            // Only someone the database would let save the edit is offered it (a therapist logging a colleague's visit is not).
            visitPermissions({
              isAdmin,
              isFrontDesk: role === 'front_desk',
              myTherapistId,
              visitTherapistId: justSaved.therapistId,
              invoiced: false,
            }).canModify
              ? () => setEditingVisit(true)
              : undefined
          }
          receivedPaise={(savedPayments ?? []).reduce((sum, p) => sum + p.amountPaise, 0)}
          onNewVisitSamePatient={() => {
            // Re-run the "rows for this patient" step, so an open package's next session is offered again.
            rowsPatientRef.current = null;
            startFreshVisitForm();
            void navigate({
              to: '/visits/new',
              search: { patientId: justSaved.patientId, ...(search.from ? { from: search.from } : {}) },
            });
          }}
          onNewVisitNextPatient={() => {
            setPatient(null);
            startFreshVisitForm();
            void navigate({
              to: '/visits/new',
              search: { ...(search.from ? { from: search.from } : {}) },
            });
          }}
          onDone={goBack}
        />
        {editingVisit && (
          <EditVisitModal
            visitId={justSaved.visitId}
            onClose={async () => {
              setEditingVisit(false);
              const updated = await repos.visits.get(justSaved.visitId);
              if (updated && !updated.deleted) {
                const items = await repos.visitItems.listByVisitIds([justSaved.visitId]);
                const label = items.map((i) => i.serviceName).filter(Boolean).join(' + ') || justSaved.serviceLabel;
                setJustSaved((prev) =>
                  prev
                    ? {
                        ...prev,
                        serviceLabel: label,
                        billPaise: updated.actualBillPaise,
                        visitDate: updated.visitDate,
                        therapistId: updated.therapistId,
                        // The bill may have changed since it was collected: what is owed now comes from the
                        // payments on record, not from the "collected on the form" flag.
                        alreadyCollected: false,
                      }
                    : null
                );
              } else if (!updated || updated.deleted) {
                setJustSaved(null);
                goBack();
              }
            }}
            setError={setError}
          />
        )}
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
  const therapistList = therapists ?? [];
  const therapistChosen = therapistList.some((t) => t.id === therapistId);
  const clinicalHidden = role === 'front_desk' && !clinicalDetailsExpanded;

  const renewFinishedPackage = () => {
    if (!finishedPackage) return;
    const catItem = catalogItems.find((c) => c.id === finishedPackage.serviceCatalogId);
    if (!catItem) return;
    const newRow: DraftLine = {
      key: newDraftKey(),
      serviceCatalogId: catItem.id,
      assistingTherapistId: null,
    };
    setRows((prev) => {
      if (prev.length === 1 && !hasService(prev[0])) {
        return [newRow];
      }
      return [...prev, newRow];
    });
  };

  const repeatLastVisit = () => {
    if (!lastVisit) return;
    if (lastVisit.therapistId && therapists?.some((t) => t.id === lastVisit.therapistId)) {
      setTherapistId(lastVisit.therapistId);
    }
    if (lastVisit.condition) setCondition(lastVisit.condition);
    if (lastVisit.treatmentNotes) setNotes(lastVisit.treatmentNotes);
    if (lastVisit.treatmentIds && lastVisit.treatmentIds.length > 0) {
      setTreatmentIds(lastVisit.treatmentIds);
    }
    if (lastVisit.location) {
      setLocation(lastVisit.location);
    }
    if (lastVisit.packageGroupId) {
      const openPkg = openPackages?.find((op) => op.packageGroupId === lastVisit.packageGroupId);
      if (openPkg) {
        setRows([continuationLine(openPkg, null)]);
        return;
      }
    }
    if (lastVisit.serviceCatalogId) {
      const catItem = catalogItems.find((c) => c.id === lastVisit.serviceCatalogId);
      if (catItem) {
        setRows([
          {
            key: newDraftKey(),
            serviceCatalogId: catItem.id,
            assistingTherapistId: null,
          },
        ]);
      }
    }
  };

  const leftCard = (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 sm:p-4 shadow-sm space-y-4">
      {/* 1. Patient section */}
      {patient ? (
        <div className="space-y-3.5">
          {/* Patient identity header */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <h2 className="truncate font-display text-base font-semibold text-[var(--ink)]">{patient.name}</h2>
                <button
                  type="button"
                  className="shrink-0 text-xs font-medium text-[var(--teal)] hover:underline"
                  onClick={() => setEditingPatient(true)}
                >
                  Edit
                </button>
              </div>
              <div className="mt-0.5 text-xs text-[var(--muted)]">
                Patient ID <span className="font-num font-medium text-[var(--ink)]">{patient.mrno}</span>
                {patient.age != null && ` · ${patient.age}y`}
                {patient.sex && ` · ${patient.sex}`}
              </div>
            </div>

            {canChangePatient(search) && (
              <button
                type="button"
                className="inline-flex h-8 shrink-0 items-center rounded-lg border border-[var(--border)] bg-[var(--paper)] px-3 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface)] hover:text-[var(--teal)] transition-colors"
                onClick={() => {
                  setPatient(null);
                  setCreatingPatient(false);
                  setQuery('');
                  touchedRef.current = false;
                }}
              >
                Change
              </button>
            )}
          </div>

          {patientBalance && patientBalance.duePaise > 0 && (
            <div
              role="status"
              className="rounded-lg bg-[var(--amber-light)] px-3 py-1.5 text-xs font-medium text-[var(--amber)]"
            >
              Balance due {formatINR(patientBalance.duePaise)} · {patientBalance.unpaidVisits} unpaid{' '}
              {patientBalance.unpaidVisits === 1 ? 'visit' : 'visits'}
            </div>
          )}

          {/* Recessed History Well: Package status & Last visit grouped */}
          {(Boolean(openPackages?.length) || Boolean(finishedPackage) || Boolean(lastVisit)) && (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--paper)] p-3 space-y-3">
              {/* Package Row */}
              {openPackages !== undefined && openPackages.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--muted)]">
                      {openPackages.length > 1 ? `Open packages (${openPackages.length})` : 'Open package'}
                    </span>
                    {packageBadge && (
                      <Pill tone={PAYMENT_CHIP[packageBadge.kind].tone}>
                        <span title={`The package itself: ${packageBadge.title}`}>{packageBadge.label}</span>
                      </Pill>
                    )}
                  </div>
                  <div className="mt-1 text-sm font-medium text-[var(--ink)]">{openPackages[0].serviceName}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--muted)]">
                    <span
                      className="inline-flex items-center gap-1"
                      title={`${openPackages[0].logged} of ${openPackages[0].packageTotal} sessions used`}
                    >
                      {Array.from({ length: openPackages[0].packageTotal }, (_, i) => (
                        <span
                          key={i}
                          className={`h-2 w-2 rounded-full ${
                            i < openPackages[0].logged ? 'bg-[var(--teal)]' : 'border border-[var(--border)] bg-transparent'
                          }`}
                        />
                      ))}
                    </span>
                    <span>
                      {openPackages[0].logged} of {openPackages[0].packageTotal} used
                    </span>
                    <span>· started {formatDateDMY(openPackages[0].startedOn)}</span>
                  </div>
                </div>
              ) : finishedPackage ? (
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--muted)]">Package</span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:border-[var(--teal)] transition-colors shadow-2xs"
                      onClick={renewFinishedPackage}
                    >
                      + Renew {finishedPackage.total}d pkg
                    </button>
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--muted)]">
                    Last package finished {formatDateDMY(finishedPackage.finishedOn)} ·{' '}
                    {catalogNameById.get(finishedPackage.serviceCatalogId) ?? 'Package'} ({finishedPackage.total} of{' '}
                    {finishedPackage.total} used)
                  </div>
                </div>
              ) : null}

              {/* Last Visit Row */}
              {patientVisits !== undefined && lastVisit && (
                <div className={openPackages?.length || finishedPackage ? 'border-t border-[var(--border)] pt-2.5' : ''}>
                  {(() => {
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
                    const session =
                      lastVisit.sessionIndex && lastVisit.packageTotal && lastVisit.packageTotal > 1
                        ? `Session ${lastVisit.sessionIndex} of ${lastVisit.packageTotal}`
                        : null;
                    const who = allTherapists?.find((t) => t.id === lastVisit.therapistId)?.name ?? null;
                    const sessionAndWho = [session, who].filter(Boolean).join(' · ');

                    return (
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-[var(--muted)]">Last visit</span>
                            <Pill tone={PAYMENT_CHIP[badge.kind].tone}>
                              <span title={badge.title}>
                                {badge.kind === 'none' && lastVisit.packageGroupId ? 'Package session' : badge.label}
                              </span>
                            </Pill>
                          </div>
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:border-[var(--teal)] transition-colors shadow-2xs"
                            onClick={repeatLastVisit}
                            title="Pre-fill therapist, treatments, and service from last visit"
                          >
                            <span aria-hidden="true">↻</span> Repeat visit
                          </button>
                        </div>
                        <div className="mt-1 flex items-baseline gap-2">
                          <span className="shrink-0 text-xs font-medium tabular-nums text-[var(--ink)]">
                            {formatDateDMY(lastVisit.visitDate)}
                          </span>
                          <span className="min-w-0 truncate text-xs text-[var(--muted)]">
                            · {catalogNameById.get(lastVisit.serviceCatalogId) ?? 'Service'}
                          </span>
                        </div>
                        {sessionAndWho && <div className="mt-0.5 text-xs text-[var(--ink)]">{sessionAndWho}</div>}
                        {lastVisitTreatments && (
                          <div className="mt-0.5 text-xs text-[var(--muted)]">
                            Treatments: <span className="text-[var(--ink)]">{lastVisitTreatments}</span>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-base font-semibold text-[var(--ink)]">Patient</h2>
          </div>
          {creatingPatient ? (
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
                    No phone on file — fine for a walk-in with none, but it limits later search and duplicate checks.
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
                <details
                  className="rounded-lg border border-[var(--border)] px-3 py-2"
                  open={Boolean(newPatient.email || newPatient.altPhone || newPatient.mrno)}
                >
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
                  disabled={busy || !newPatient.name.trim()}
                  onClick={() => void createPatient()}
                >
                  {busy ? 'Creating…' : 'Create patient'}
                </button>
                <button type="button" className={btnSecondary} onClick={backToSearch}>
                  Back to search
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <input
                type="search"
                enterKeyHint="search"
                aria-label="Find patient"
                className={inputCls}
                placeholder="Search ID, name or phone…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && matches?.[0]) {
                    e.preventDefault();
                    selectPatientFromSearch(matches[0]);
                  }
                }}
                autoFocus
              />
              {query.trim() ? (
                <>
                  {(matches ?? []).map((p) => {
                    const subtitle = formatPatientSearchResultSubtitle(p);
                    return (
                      <button
                        type="button"
                        key={p.id}
                        className="flex min-h-11 w-full items-center justify-between rounded-md border border-[var(--border)] px-3 py-2 text-left text-sm hover:bg-[var(--paper)] transition-colors"
                        onClick={() => selectPatientFromSearch(p)}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-display font-medium text-[var(--ink)]">{p.name}</div>
                          {subtitle && (
                            <div className="truncate text-xs text-[var(--muted)]">
                              {subtitle}
                            </div>
                          )}
                        </div>
                        <span className="ml-2 shrink-0 text-xs tabular-nums text-[var(--muted)]">{p.mrno}</span>
                      </button>
                    );
                  })}
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
                          className="min-h-9 rounded-full border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--ink)] hover:bg-[var(--paper)] transition-colors"
                          onClick={() =>
                            void repos.patients
                              .get(p.patientId)
                              .then((full) => full && selectPatientFromSearch(full))
                          }
                        >
                          <span className="font-display font-medium">{p.patientName}</span>{' '}
                          <span className="font-num text-[var(--muted)]">{p.mrno}</span>
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
        </div>
      )}

      {/* 2. Divider between Patient and This Visit */}
      <div className="border-t border-[var(--border)]" />

      {/* 3. This visit interactive inputs */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-[var(--ink)]">This visit</h2>
          <SegmentedToggle
            value={location}
            onChange={setLocation}
            options={[
              { value: 'clinic', label: 'Clinic' },
              { value: 'home', label: 'Home visit' },
            ]}
          />
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <div>
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Date</span>
            <label className="relative flex h-8 cursor-pointer items-center justify-between rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--ink)] hover:border-[var(--teal)] transition-colors">
              <span className="truncate tabular-nums">{visitDateLabel}</span>
              <span aria-hidden="true" className="shrink-0 text-[10px] text-[var(--muted)] ml-1">▾</span>
              <input
                type="date"
                aria-label="Visit date"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                value={visitDate}
                onChange={(e) => setVisitDate(e.target.value)}
                onClick={(e) => {
                  try {
                    e.currentTarget.showPicker?.();
                  } catch {
                    /* fallback */
                  }
                }}
              />
            </label>
          </div>

          <div>
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Therapist *</span>
            <PickerMenu
              ariaLabel="Therapist"
              caption="Who treated the patient"
              value={therapistChosen ? therapistId : ''}
              options={therapistList.map((t) => ({
                value: t.id,
                label: t.id === myTherapistId ? `${t.name} (You)` : t.name,
                dotColor: therapistColor(t.id, t.color),
              }))}
              onChange={setTherapistId}
              triggerClassName={`flex h-8 w-full items-center justify-between rounded-full border px-3 text-xs font-medium transition-colors ${
                therapistChosen
                  ? 'border-[var(--border)] bg-[var(--teal-light)] text-[var(--teal-strong)]'
                  : 'border-[var(--rust)] bg-[var(--surface)] text-[var(--ink)]'
              }`}
              renderTrigger={(selected) => (
                <>
                  <div className="flex min-w-0 items-center gap-1.5 truncate">
                    {selected?.dotColor && (
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: selected.dotColor }} />
                    )}
                    <span className="truncate">{selected?.label ?? 'Choose therapist'}</span>
                  </div>
                  <span aria-hidden="true" className="shrink-0 text-[10px] ml-1 opacity-70">▾</span>
                </>
              )}
            />
          </div>
        </div>

        {clinicalHidden ? (
          <button
            type="button"
            className="text-left text-xs font-medium text-[var(--teal)] hover:underline"
            onClick={() => setClinicalDetailsExpanded(true)}
          >
            + Add condition / treatments (optional)
          </button>
        ) : (
          <div>
            <span className="mb-1 block text-xs font-medium text-[var(--muted)]">Condition (this visit)</span>
            {customConditionOpen || (condition && !knownConditions.some((c) => c.toLowerCase() === condition.toLowerCase())) ? (
              <div className="flex items-center gap-2">
                <input
                  className={inputCls}
                  autoFocus
                  placeholder="Condition for this visit…"
                  value={condition}
                  onChange={(e) => setCondition(e.target.value)}
                />
                <button
                  type="button"
                  className="text-xs text-[var(--muted)] hover:text-[var(--ink)] shrink-0"
                  onClick={() => {
                    setCustomConditionOpen(false);
                    if (!knownConditions.some((c) => c.toLowerCase() === condition.toLowerCase())) setCondition('');
                  }}
                >
                  Cancel
                </button>
              </div>
            ) : knownConditions.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1.5">
                {knownConditions.map((cond) => {
                  const isSelected = condition === cond;
                  return (
                    <button
                      type="button"
                      key={cond}
                      onClick={() => setCondition(isSelected ? '' : cond)}
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                        isSelected
                          ? 'border-[var(--teal)] bg-[var(--teal-light)] text-[var(--teal-strong)]'
                          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--teal)]'
                      }`}
                    >
                      {isSelected && <span aria-hidden="true">✓</span>}
                      <span>{cond}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border)] px-2.5 py-1 text-xs font-medium text-[var(--teal)] hover:border-[var(--teal)]"
                  onClick={() => setCustomConditionOpen(true)}
                >
                  + Other
                </button>
              </div>
            ) : (
              <input
                className={inputCls}
                placeholder="e.g. Knee Pain"
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
              />
            )}
          </div>
        )}
      </div>

      {/* 4. Start note button (quiet clinical bridge at bottom, only when patient selected) */}
      {patient && clinic.clinicalDocsEnabled && canWriteNotes && (
        <div className="border-t border-[var(--border)] pt-1">
          <button
            type="button"
            className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--paper)] text-xs font-medium text-[var(--teal)] hover:border-[var(--teal)] hover:bg-[var(--surface)] transition-colors"
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
            title="Start clinical note first (add service later)"
          >
            <IconPen className="h-3.5 w-3.5" />
            <span>Start a note first</span>
          </button>
        </div>
      )}
    </div>
  );

  // --- Treatments: the chips while ticking, one summary line once folded.
  const orderedTreatments = [...rankedTreatments.frequent, ...rankedTreatments.rest];
  const visibleTreatments = visibleTreatmentOptions(orderedTreatments, treatmentIds, showAllTreatments);
  const hiddenTreatments = orderedTreatments.length - visibleTreatments.length;
  const treatmentSummary =
    [
      treatmentIds.map((id) => treatmentNameById.get(id)).filter(Boolean).join(' · '),
      notes.trim(),
    ]
      .filter(Boolean)
      .join(' · ') || 'None added';
  const treatmentsCard = clinicalHidden ? null : treatmentsOpen ? (
    <SectionCard
      title="Treatments"
      action={
        hasTreatmentInfo ? (
          <button
            type="button"
            className="h-8 text-xs font-medium text-[var(--teal)] hover:underline"
            onClick={() => setTreatmentsOpen(false)}
          >
            Done ▴
          </button>
        ) : undefined
      }
    >
      <div className="space-y-2">
        <MultiToggle
          options={visibleTreatments.map((t) => ({ value: t.id, label: t.name }))}
          value={treatmentIds}
          onChange={setTreatmentIds}
          trailing={
            hiddenTreatments > 0 ? (
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-full border border-dashed border-[var(--border)] px-3 text-xs font-medium text-[var(--teal)] hover:border-[var(--teal)]"
                onClick={() => setShowAllTreatments(true)}
              >
                + {hiddenTreatments} more
              </button>
            ) : undefined
          }
        />
        <p className="mb-1 text-xs font-medium text-[var(--muted)]">Other treatments / notes</p>
        <input
          className={inputCls}
          aria-label="Other treatments / notes"
          placeholder="Anything not in the list…"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </SectionCard>
  ) : (
    <SectionCard
      title="Treatments"
      action={
        <button
          type="button"
          className="h-8 text-xs font-medium text-[var(--teal)] hover:underline"
          aria-expanded={false}
          onClick={() => setTreatmentsOpen(true)}
        >
          Edit ▾
        </button>
      }
    >
      <p className={`text-sm ${treatmentSummary === 'None added' ? 'text-[var(--muted)]' : 'text-[var(--ink)]'}`}>
        {treatmentSummary}
      </p>
    </SectionCard>
  );

  const visitPanel = (
    <div className="space-y-4">
      {treatmentsCard}

      <SectionCard id="visit-services" title="Services">
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
            revealProblems={revealRowProblems}
            patientName={patient?.name}
            quickServices={quickServices}
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

          {packageMoveNote && (
            <p className="text-xs text-[var(--muted)]" data-testid="package-move-note">
              {packageMoveNote}
            </p>
          )}

          {billPaise > 0 && !canCollectPayment && (
            <p className="text-xs text-[var(--muted)]">
              This visit will be saved as unbilled — billing is handled separately at this clinic.
            </p>
          )}
        </div>
      </SectionCard>

      <div id="visit-payment" className="scroll-mt-24">
        <SectionCard title="Payment">
          <div className="space-y-4">
            {canCollectPayment && (catalogPricePaise > 0 || billPaise > 0) ? (
              <div className="space-y-3.5">
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-4 sm:gap-y-2.5">
                  <SegmentedToggle
                    value={paymentChoice}
                    onChange={setPaymentChoice}
                    options={[
                      { value: 'paid', label: 'Collected now' },
                      { value: 'pending', label: 'Take payment later' },
                    ]}
                  />
                  {paymentChoice === 'paid' ? (
                    <PaymentMethodChips
                      value={paymentMethod}
                      onChange={setPaymentMethod}
                      options={paymentMethods}
                      disabled={busy}
                    />
                  ) : (
                    <input
                      className={`${inputCls} w-full sm:min-w-[14rem] sm:flex-1`}
                      placeholder="Optional note — e.g. will pay next Monday"
                      value={pendingNote}
                      onChange={(e) => setPendingNote(e.target.value)}
                    />
                  )}
                </div>

                {paymentChoice === 'paid' && paymentMethod === 'upi' && patient && (
                  <div className="flex items-center gap-2.5 pt-0.5">
                    <ShowUpiQrButton
                      amountPaise={billPaise}
                      mrno={patient.mrno}
                      visitDate={visitDate}
                      patientName={patient.name}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 text-xs font-medium text-[var(--teal)] hover:border-[var(--teal)] hover:bg-[var(--paper)] transition-colors shadow-2xs"
                    />
                    <span className="text-xs text-[var(--muted)]">
                      Scan to collect {formatINR(billPaise)} directly to clinic UPI
                    </span>
                  </div>
                )}

                {/* Compact Adjustment: Discount / Extra */}
                <div className="pt-0.5">
                  <BillAdjustmentFields
                    catalogPricePaise={catalogPricePaise}
                    catalogLabel="Subtotal"
                    totalLabel="Total"
                    hideSummaryBoxes
                    disabled={catalogPricePaise === 0}
                    mode={adjustmentMode}
                    valueType={adjustmentValueType}
                    value={adjustmentValue}
                    reason={adjustmentReason}
                    onModeChange={setAdjustmentMode}
                    onValueTypeChange={setAdjustmentValueType}
                    onValueChange={setAdjustmentValue}
                    onReasonChange={setAdjustmentReason}
                    hasPackageInCart={hasPackageInCart}
                  />
                </div>
              </div>
            ) : billPaise === 0 && servicesChosen > 0 ? (
              <p className="text-xs text-[var(--muted)]">
                📦 Package session — no payment needed for this session.
              </p>
            ) : !canCollectPayment && billPaise > 0 ? (
              <p className="text-xs text-[var(--muted)]">
                This visit will be saved as unbilled — billing is handled separately at this clinic.
              </p>
            ) : (
              <p className="text-xs text-[var(--muted)]">
                Select a service above to calculate bill and record payment.
              </p>
            )}

            {/* Total & Save: Flush recessed footer inside Payment card */}
            <div className="-mx-5 -mb-5 mt-4 rounded-b-2xl border-t border-[var(--border)] bg-[var(--paper)] px-5 py-3.5 space-y-1.5">
              {/* Single clean line directly above the total */}
              {servicesChosen === 0 ? (
                <p className="text-xs text-[var(--muted)]">
                  Choose patient, therapist &amp; service to save
                </p>
              ) : footerSummaryLine && !footerSummaryLine.hasAdjustment ? (
                <p className="text-xs text-[var(--muted)] truncate" title={footerSummaryLine.text}>
                  {footerSummaryLine.text}
                </p>
              ) : footerSummaryLine && footerSummaryLine.hasAdjustment ? (
                <p className="flex flex-wrap items-center gap-x-1.5 font-num text-xs text-[var(--muted)]">
                  <span className="font-semibold text-[var(--ink)]">
                    {footerSummaryLine.subtotalFormatted}
                  </span>
                  <span className="font-sans text-[var(--muted)]">
                    ({footerSummaryLine.servicesTitle})
                  </span>
                  <span className="mx-1 font-sans font-bold text-[var(--ink)]">
                    {footerSummaryLine.sign}
                  </span>
                  <span className="font-semibold text-[var(--teal-strong)]">
                    {footerSummaryLine.diffFormatted}
                  </span>
                  <span className="text-[var(--teal-strong)] font-sans">
                    {footerSummaryLine.modeLabel}
                    {footerSummaryLine.reasonPart}
                  </span>
                </p>
              ) : null}

              {/* Execution row: Big price BEFORE label so numbers left-align cleanly, and actions on right */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between pt-0.5">
                <div className="flex items-baseline gap-2">
                  <span
                    className={`font-num text-2xl font-extrabold tracking-tight tabular-nums ${
                      servicesChosen === 0 ? 'text-[var(--muted)]' : 'text-[var(--ink)]'
                    }`}
                  >
                    {servicesChosen === 0 ? '₹0' : formatINR(billPaise)}
                  </span>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
                    Total
                  </span>
                </div>

                {/* Actions: Cancel & Save Visit (touch-friendly and responsive) */}
                <div className="flex w-full sm:w-auto items-center gap-2.5 shrink-0">
                  <button
                    type="button"
                    className={`${btnSecondary} flex-1 sm:flex-initial justify-center h-10 rounded-xl px-4 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--surface)]`}
                    disabled={busy}
                    onClick={requestExit}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    aria-label={busy ? 'Saving…' : 'Save visit'}
                    title="Save visit (⌘ + Enter)"
                    className={`${btnPrimary} flex-1 sm:flex-initial flex h-10 shrink-0 items-center justify-center rounded-xl whitespace-nowrap px-5 text-xs font-semibold shadow-xs hover:shadow-md transition-all`}
                    disabled={busy || servicesChosen === 0}
                    onClick={() => void save()}
                  >
                    <span>{busy ? 'Saving…' : 'Save visit'}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </SectionCard>
      </div>

      <div ref={errorRef}>
        <ErrorNote message={error} />
      </div>
    </div>
  );

  return (
    <div
      className="nv-form mx-auto max-w-5xl space-y-4 pb-12"
      onPointerDownCapture={() => {
        touchedRef.current = true;
      }}
      onKeyDownCapture={() => {
        touchedRef.current = true;
      }}
    >
      {/* Page navigational header: Back button, title beside it, and status on the right */}
      <div className="flex items-center justify-between gap-3 pt-1">
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={requestExit}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 pl-1.5 pr-3 text-sm font-medium text-[var(--muted)] transition-colors hover:border-[var(--teal)]/40 hover:bg-[var(--paper)] hover:text-[var(--ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--teal)] disabled:opacity-50 shadow-2xs"
            title={`Back to ${backLabel}`}
          >
            <IconChevronLeft className="h-4 w-4" aria-hidden="true" />
            <span>{backLabel}</span>
          </button>
          <h1 className="font-display text-xl font-semibold text-[var(--ink)] sm:text-2xl">
            New visit
          </h1>
        </div>

        {isDirty && (
          <div className="flex items-center gap-1.5 rounded-full bg-[var(--amber-light)] px-2.5 py-1 text-xs font-medium text-[var(--amber)]">
            <span
              role="img"
              aria-label="Unsaved changes"
              title="Unsaved changes"
              className="h-2 w-2 shrink-0 rounded-full bg-[var(--amber)]"
            />
            <span>Unsaved changes</span>
          </div>
        )}
      </div>
      <VisitCapNotice />

      {/* Same two-column shape (reference panel left, form right) whether or
          not a patient is picked yet — the *content* inside the left panel
          changes (search/create UI vs. confirmed-patient banner), but the
          page's own structure doesn't, so picking a patient doesn't cause a
          jarring column-count/width jump. Collapses to stacked below desktop:. */}
      <div className="grid gap-4 desktop:grid-cols-[22.5rem_minmax(0,1fr)] desktop:items-start">
        {/* Left card: unified patient info + this visit context */}
        <div className="desktop:sticky desktop:top-[calc(var(--app-header-h,4rem)+1rem)]">
          {leftCard}
        </div>
        <div className="min-w-0">{visitPanel}</div>
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

      <StartVisitSheet
        open={startNoteOpen}
        initialPatientId={patient?.id}
        returnTo={search.from}
        onClose={() => setStartNoteOpen(false)}
      />

      <ConfirmDialog
        open={blocker.status === 'blocked' || discardOpen}
        title="Discard this visit?"
        message="You have unsaved changes on this visit. Are you sure you want to discard them and leave?"
        confirmLabel="Discard & leave"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          touchedRef.current = false;
          isDirtyRef.current = false;
          if (blocker.status === 'blocked') {
            blocker.proceed?.();
          } else {
            setDiscardOpen(false);
            goBack();
          }
        }}
        onCancel={() => {
          if (blocker.status === 'blocked') {
            blocker.reset?.();
          }
          setDiscardOpen(false);
        }}
      />
    </div>
  );
}
