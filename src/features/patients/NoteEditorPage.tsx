import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { getSupabase } from '@/lib/supabase';
import { ScaleWidget } from '@/components/ScaleWidget';
import { BodyChart } from '@/components/BodyChart';
import { Pill } from '@/components/ui';
import { repos, consultationNoteService } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import {
  RED_FLAG_ITEMS,
  YELLOW_FLAG_ITEMS,
  NEURO_LEVELS,
  REFLEX_ITEMS,
  ANATOMICAL_REGIONS,
  ROM_MOVEMENTS_BY_REGION,
  SPINE_REGIONS,
  SPINE_ROM,
  OCCUPATION_GROUPS,
  ACTIVITY_GROUPS,
  SESSION_DURATIONS,
  PSFS_MCID_THRESHOLD,
  emptyPayload,
  upcastPayload,
  computeDerivedFields,
  computeBmi,
  computeWaistToHeightRatio,
  outcomeTrend,
  type CoreAssessmentPayload,
  type RedFlagItem,
  type RedFlagState,
  type YellowFlagItem,
  type YellowFlagState,
  type NeuroLevel,
  type ReflexItem,
  type DermatomeResult,
  type MyotomeResult,
  type ReflexResult,
  type RomEntry,
  NOTE_SECTION_KEYS,
  sectionCompletion,
  type NoteSectionKey,
  type SectionCompletion,
} from '@/domain/coreAssessment';

const SECTION_LABELS: Record<NoteSectionKey, string> = {
  chiefComplaint: 'Chief Complaint',
  history: 'History',
  // "Pain & Body Chart", not "Subjective" — this section holds the pain
  // profile and body chart specifically, and the rail now groups sections
  // under SOAP headings where "Subjective" is the *group* name.
  subjective: 'Pain & Body Chart',
  psfs: 'Functional Status',
  objective: 'Objective',
  treatment: 'Treatment',
  hep: 'Home Exercise Program',
  plan: 'Plan & Goals',
  outcome: 'Outcome Tracking',
};

/**
 * Jump-nav grouping, following the SOAP structure a physiotherapy note is
 * actually organized around — nine flat items in one undifferentiated list
 * gave no sense of where you were in the note. Purely a rail-presentation
 * concern: the section order and the accordion below are unchanged, and
 * every NoteSectionKey appears exactly once (asserted at the bottom).
 */
const SECTION_GROUPS: { label: string; keys: NoteSectionKey[] }[] = [
  { label: 'Subjective', keys: ['chiefComplaint', 'history', 'subjective', 'psfs'] },
  { label: 'Objective', keys: ['objective'] },
  { label: 'Plan', keys: ['treatment', 'hep', 'plan'] },
  { label: 'Progress', keys: ['outcome'] },
];

/** empty=untouched, partial=in progress, complete=done, required-empty=the
 *  one field save() actually enforces (Chief Complaint's anatomical region). */
const STATUS_DOT: Record<SectionCompletion, string> = {
  empty: 'var(--border)',
  partial: 'var(--amber)',
  complete: 'var(--moss)',
  'required-empty': 'var(--rust)',
};

// Fails the build if SECTION_GROUPS ever drifts from NOTE_SECTION_KEYS —
// a section added to the note but missed here would silently vanish from
// the jump-nav, which is exactly the kind of two-lists-must-agree gap that
// has bitten this codebase before.
if (SECTION_GROUPS.flatMap((g) => g.keys).length !== NOTE_SECTION_KEYS.length) {
  throw new Error('SECTION_GROUPS is out of sync with NOTE_SECTION_KEYS');
}

/** How long a rail-click's scrollIntoView animation is given before the
 *  scroll-spy observer is trusted again — long enough that it doesn't
 *  fight the click by re-highlighting whatever section scrolls past on
 *  the way to the target. */
const SCROLL_SPY_SUPPRESS_MS = 700;

/** Toggle-chip multi-select: value is the array of selected labels. */
function MultiToggle({ options, value, onChange }: { options: readonly string[]; value: string[]; onChange: (next: string[]) => void }) {
  return (
    <div className="chip-row">
      {options.map((opt) => {
        const on = value.includes(opt);
        return (
          <button
            key={opt}
            type="button"
            className={`toggle-chip ${on ? 'on' : ''}`}
            onClick={() => onChange(on ? value.filter((v) => v !== opt) : [...value, opt])}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

function RedFlagPill({ item, state, onChange }: { item: RedFlagItem; state: RedFlagState; onChange: (next: RedFlagState) => void }) {
  const cycle: RedFlagState[] = ['not-assessed', 'yes', 'no'];
  return (
    <button
      type="button"
      className={`flag-pill ${state === 'not-assessed' ? '' : state}`}
      onClick={() => onChange(cycle[(cycle.indexOf(state) + 1) % cycle.length])}
    >
      {item} — {state === 'not-assessed' ? 'not assessed' : state}
    </button>
  );
}

function YellowFlagPill({ item, state, onChange }: { item: YellowFlagItem; state: YellowFlagState; onChange: (next: YellowFlagState) => void }) {
  const cycle: YellowFlagState[] = ['not-assessed', 'some-concern', 'significant-concern', 'no-concern'];
  return (
    <button
      type="button"
      className={`flag-pill ${state === 'no-concern' ? 'no' : state === 'not-assessed' ? '' : state}`}
      onClick={() => onChange(cycle[(cycle.indexOf(state) + 1) % cycle.length])}
    >
      {item} — {state === 'not-assessed' ? 'not assessed' : state.replace('-', ' ')}
    </button>
  );
}

function CarryForward({ summary, onUpdate }: { summary: string; onUpdate: () => void }) {
  return (
    <div className="followup-only carry-forward">
      {summary}
      <button className="cf-update" onClick={onUpdate}>Update</button>
    </div>
  );
}

/** Region-driven movement quick-pick for a ROM/Strength row — writes into the
 *  same free-text `movement` field the input already uses, so choosing one
 *  is just a fast-fill, not a separate data path. Only rendered once an
 *  Anatomical Region is selected. */
function MovementQuickPick({
  region,
  onPick,
  disabled,
}: {
  region: (typeof ANATOMICAL_REGIONS)[number] | '';
  onPick: (movement: string) => void;
  disabled?: boolean;
}) {
  if (!region) return null;
  return (
    <select value="" disabled={disabled} onChange={(e) => e.target.value && onPick(e.target.value)} style={{ maxWidth: 150 }}>
      <option value="">Quick pick…</option>
      {ROM_MOVEMENTS_BY_REGION[region].map((m) => (
        <option key={m} value={m}>{m}</option>
      ))}
    </select>
  );
}

/** Best-effort, online-only read of current_consents — never blocks saving a draft. */
function useTreatmentConsentStatus(clinicId: string, patientId: string) {
  const [status, setStatus] = useState<'unknown' | 'on_file' | 'not_on_file'>('unknown');
  useEffect(() => {
    let cancelled = false;
    const supabase = getSupabase();
    if (!supabase) return;
    Promise.resolve(
      supabase
        .from('current_consents')
        .select('is_in_force')
        .eq('clinic_id', clinicId)
        .eq('patient_id', patientId)
        .eq('consent_type', 'patient_treatment')
        .maybeSingle()
    )
      .then(({ data }: { data: { is_in_force: boolean } | null }) => {
        if (!cancelled) setStatus(data?.is_in_force ? 'on_file' : 'not_on_file');
      })
      .catch(() => {
        if (!cancelled) setStatus('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, [clinicId, patientId]);
  return status;
}

/**
 * Full-page Core Assessment note editor. Handles both /notes/new (no note
 * yet — attaches to the patient's active enrollment/episode, first save
 * creates the draft) and /notes/$noteId (existing draft/completed note).
 * noteMode (Initial vs Follow-up) is derived from enrollment state, not
 * user-selectable — see docs/CORE-ASSESSMENT-PORT-PLAN.md.
 */
export function NoteEditorPage() {
  const clinic = useClinic();
  const navigate = useNavigate();
  const { canViewClinicalNotes } = usePermissions();
  const { patientId, noteId } = useParams({ strict: false }) as {
    patientId: string;
    noteId?: string;
  };
  // Set only when this note was opened from a specific visit's "add note"
  // nudge (New Visit's save-success offer, a Seen Today card, or the
  // Needs-attention list) — ignored once an existing note is loaded, which
  // carries its own visitId.
  const { visitId: promptedVisitId } = useSearch({ strict: false }) as { visitId?: string };

  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id), [clinic.id]);
  const existingNote = useLiveQuery(
    () => (noteId ? repos.consultationNotes.get(noteId) : Promise.resolve(undefined)),
    [noteId]
  );
  const consentStatus = useTreatmentConsentStatus(clinic.id, patientId);

  const [therapistId, setTherapistId] = useState('');
  const [noteMode, setNoteMode] = useState<'initial' | 'followup'>('initial');
  const [enrollmentId, setEnrollmentId] = useState<string | null>(null);
  const [payload, setPayload] = useState<CoreAssessmentPayload>(emptyPayload());
  const [status, setStatus] = useState<'draft' | 'completed'>('draft');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const enrollment = useLiveQuery(() => (enrollmentId ? repos.patientModuleEnrollments.get(enrollmentId) : undefined), [enrollmentId]);
  const enrollmentNotes = useLiveQuery(() => (enrollmentId ? repos.consultationNotes.listByEnrollment(enrollmentId) : undefined), [enrollmentId]);
  const visitNumber = enrollmentNotes ? enrollmentNotes.length + (existingNote ? 0 : 1) : null;

  // Follow-up mode: Chief Complaint / History / Screening default collapsed
  // read-only, carried forward, with an "Update" affordance. Initial mode
  // never collapses these.
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['chiefComplaint', 'history', 'screening']));
  function isCollapsed(section: string) {
    return noteMode === 'followup' && !expanded.has(section);
  }
  function expand(section: string) {
    setExpanded((s) => new Set(s).add(section));
  }

  // Accordion open/close (Setup-style .setup-accordion), independent of the
  // carry-forward collapse above. Sections start expanded — the jump-nav
  // rail below is the intended way to navigate a long note, and "everything
  // open" is what makes its status dots and click-to-jump useful; collapse
  // all is the escape hatch for anyone who wants the short view.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(NOTE_SECTION_KEYS));
  function toggleSection(key: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleCollapseAll() {
    setOpenSections((prev) => (prev.size > 0 ? new Set() : new Set(NOTE_SECTION_KEYS)));
  }
  const [screeningOpen, setScreeningOpen] = useState(false);

  // Jump-nav rail (md: and up only — not a stepper, free jumping between
  // sections since clinical documentation is non-linear). activeSection
  // tracks which section is currently in view via IntersectionObserver;
  // a rail click overrides that immediately and suppresses the observer
  // briefly so it doesn't fight the programmatic scroll.
  const [activeSection, setActiveSection] = useState<NoteSectionKey>(NOTE_SECTION_KEYS[0]);
  const sectionRefs = useRef(new Map<NoteSectionKey, HTMLDivElement>());
  const suppressSpyRef = useRef(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (suppressSpyRef.current) return;
        // The entry whose top is closest to (but not past) the observer's
        // near-top trigger line is the section currently "in view" for
        // navigation purposes — matches how a reading position, not just
        // any intersection, is usually meant by "current section."
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        const topMost = visible.reduce((a, b) => (a.boundingClientRect.top <= b.boundingClientRect.top ? a : b));
        const key = ([...sectionRefs.current.entries()].find(([, el]) => el === topMost.target)?.[0]) as
          | NoteSectionKey
          | undefined;
        if (key) setActiveSection(key);
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 }
    );
    for (const el of sectionRefs.current.values()) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function jumpToSection(key: NoteSectionKey) {
    setOpenSections((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
    setActiveSection(key);
    suppressSpyRef.current = true;
    // Opening a closed section changes the page's layout (its body was
    // display:none), so the scroll has to happen after that reflow lands,
    // not in the same tick — otherwise it scrolls to where the heading
    // used to be.
    requestAnimationFrame(() => {
      sectionRefs.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    setTimeout(() => {
      suppressSpyRef.current = false;
    }, SCROLL_SPY_SUPPRESS_MS);
  }

  // Neurological screen: collapsed by default once WNL, expands automatically
  // if any level is flagged, or on manual expand.
  const [neuroExpanded, setNeuroExpanded] = useState(false);

  useEffect(() => {
    if (therapists && therapists.length > 0 && !therapistId) setTherapistId(therapists[0].id);
  }, [therapists, therapistId]);

  // Whether the most recent prior note in this episode actually has
  // chief-complaint/history data worth carrying forward — distinct from
  // noteMode: a note can be correctly classified 'followup' (a prior note
  // exists) while that prior note itself is a data gap (an empty draft,
  // one predating this field). Only meaningful once ready; left true for
  // an Initial note so the "no prior note" banner never shows there.
  const [priorNoteHasCarryForwardData, setPriorNoteHasCarryForwardData] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (existingNote) {
        setEnrollmentId(existingNote.enrollmentId);
        const mode = existingNote.noteMode ?? 'initial';
        setNoteMode(mode);
        setStatus(existingNote.status === 'completed' ? 'completed' : 'draft');
        setTherapistId(existingNote.therapistId);
        if (existingNote.assessmentPayload) {
          setPayload(upcastPayload(existingNote.assessmentPayload));
        }
        if (mode === 'followup') setExpanded(new Set());
        setReady(true);
        return;
      }
      if (noteId) return;
      const enrollment = await consultationNoteService.getOrCreateActiveEnrollment(clinic.id, patientId);
      const mode = await consultationNoteService.noteModeFor(enrollment.id);
      if (cancelled) return;
      setEnrollmentId(enrollment.id);
      setNoteMode(mode);
      if (mode === 'followup') {
        setExpanded(new Set());
        // A fresh follow-up note otherwise starts from emptyPayload() —
        // nothing upstream ever copies the prior note's stable fields in,
        // which would make the collapsed "carried forward" summary always
        // read as empty regardless of what the prior note actually had.
        // Chief complaint and history carry forward (stable across an
        // episode); subjective/objective/treatment/plan intentionally
        // don't — those are today's findings, not yesterday's.
        const priorInEnrollment = await repos.consultationNotes.listByEnrollment(enrollment.id);
        const previous = priorInEnrollment[priorInEnrollment.length - 1];
        const prevPayload = previous?.assessmentPayload ? upcastPayload(previous.assessmentPayload) : null;
        const hasData =
          !!prevPayload &&
          (!!prevPayload.chiefComplaint.anatomicalRegion ||
            prevPayload.history.medicalConditions.length > 0 ||
            !!prevPayload.history.medications ||
            !!prevPayload.history.allergies);
        if (cancelled) return;
        setPriorNoteHasCarryForwardData(hasData);
        if (prevPayload) {
          setPayload((p) => ({ ...p, chiefComplaint: prevPayload.chiefComplaint, history: prevPayload.history }));
        }
      }
      setReady(true);
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [noteId, existingNote, clinic.id, patientId]);

  const derived = computeDerivedFields(payload);
  const psfsImproving = payload.functionalStatus.activities.filter(
    (a) => a.current - a.baseline >= PSFS_MCID_THRESHOLD
  ).length;
  const bmi = computeBmi(payload.generalHealth?.weightKg, payload.generalHealth?.heightCm);
  const waistToHeight = computeWaistToHeightRatio(payload.generalHealth?.waistCm, payload.generalHealth?.heightCm);

  const neuroFlagged = NEURO_LEVELS.some((l) => {
    const d = payload.neurologicalScreen.dermatomes[l];
    const m = payload.neurologicalScreen.myotomes[l];
    return (d && d !== 'normal' && d !== 'not-tested') || (m && m !== 'normal' && m !== 'not-tested');
  });
  const showNeuroTable = neuroExpanded || neuroFlagged;

  // Most recent note in this episode before the one being edited —
  // listByEnrollment() is oldest-first, so excluding this note's own id
  // (undefined for a brand-new note, which excludes nothing) and taking
  // the last of what's left gives the prior note to trend against.
  const previousNote = (enrollmentNotes ?? []).filter((n) => n.id !== noteId).slice(-1)[0];
  const outcomeCards: {
    instrument: string;
    latest: number;
    previous: number | null;
    direction: 'higher-is-better' | 'lower-is-better';
  }[] = [];
  if (derived.psfsMean !== null) {
    outcomeCards.push({
      instrument: 'PSFS',
      latest: derived.psfsMean,
      previous: previousNote?.psfsMean ?? null,
      direction: 'higher-is-better',
    });
  }
  if (derived.nrsScore !== null) {
    outcomeCards.push({
      instrument: 'NRS',
      latest: derived.nrsScore,
      previous: previousNote?.nrsScore ?? null,
      direction: 'lower-is-better',
    });
  }

  async function save(nextStatus: 'draft' | 'completed') {
    if (!enrollmentId || !therapistId) return;
    if (!payload.chiefComplaint.anatomicalRegion) {
      setError('Anatomical region is required before saving.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await consultationNoteService.saveAssessment(
        {
          id: existingNote?.id,
          clinicId: clinic.id,
          patientId,
          therapistId,
          visitId: existingNote?.visitId ?? promptedVisitId ?? null,
          enrollmentId,
          noteMode,
          authorizedSessionCount: null,
        },
        payload,
        nextStatus
      );
      navigate({ to: '/patients/$patientId', params: { patientId } });
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function update<K extends keyof CoreAssessmentPayload>(key: K, value: CoreAssessmentPayload[K]) {
    setPayload((p) => ({ ...p, [key]: value }));
  }

  /** Upserts a ROM entry by movement name — used by both the freeform ROM
   *  list and the spine-only quick-preset table, so they share one source
   *  of truth in `objective.rom` rather than a parallel structure. */
  function upsertRom(movement: string, patch: Partial<RomEntry>) {
    const exists = payload.objective.rom.some((r) => r.movement === movement);
    const rom = exists
      ? payload.objective.rom.map((r) => (r.movement === movement ? { ...r, ...patch } : r))
      : [...payload.objective.rom, { movement, active: null, passive: null, unit: 'deg' as const, painProvoked: false, ...patch }];
    update('objective', { ...payload.objective, rom });
  }

  if (!ready || patient === undefined) return null;

  // Display-level gate matching PatientProfilePage's ConsultationNotePanel
  // gating — front desk has no clinical-documentation need. RLS still
  // allows front desk to *read* consultation_notes (the patient profile's
  // safety-flags banner depends on that), so this route must enforce the
  // same boundary itself rather than relying on a failed query.
  if (!canViewClinicalNotes) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Clinical notes</h1>
        <p className="text-sm text-[var(--muted)]">
          Clinical notes are managed by clinical staff.
        </p>
        <Link to="/patients/$patientId" params={{ patientId }} className="text-sm text-[var(--teal)] hover:underline">
          ← Back to patient
        </Link>
      </div>
    );
  }

  const readOnly = status === 'completed';
  const episodeCondition = patient?.primaryCondition || 'Episode of care';
  const enrolledDate = enrollment?.enrolledAt ? new Date(enrollment.enrolledAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : null;
  const episodeLine = [
    `Episode: ${episodeCondition}`,
    enrolledDate ? `enrolled ${enrolledDate}` : null,
    visitNumber ? `Visit ${visitNumber}` : null,
    noteMode === 'initial' ? 'Initial Evaluation' : 'Follow-up',
  ].filter(Boolean).join(' · ');

  const initials = patient
    ? patient.name
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() ?? '')
        .join('')
    : '';

  const region = payload.chiefComplaint.anatomicalRegion;

  return (
    <div>
      <header className="app-header">
        <Link
          to="/patients/$patientId"
          params={{ patientId }}
          className="btn-secondary"
          style={{ marginBottom: 8, display: 'inline-block', textDecoration: 'none' }}
        >
          ← {patient?.name ?? 'Patient'}
        </Link>
        <h1 className="screen-title">Assessment</h1>
      </header>

      <div className="screen-body">
        {error && (
          <div className="frozen-note" style={{ background: 'var(--rust-light)', color: 'var(--rust)' }}>
            {error}
            <button className="panel-close" onClick={() => setError(null)}>✕</button>
          </div>
        )}
        {readOnly && (
          <div className="frozen-note">⚠ This note is completed and read-only. Corrections need a new dated addendum note.</div>
        )}

        <div className="ne-topbar">
          <div className="mode-toggle" title="Mode is derived from enrollment state, not user-selectable">
            <button type="button" className={noteMode === 'initial' ? 'active' : ''} disabled>Initial</button>
            <button type="button" className={noteMode === 'followup' ? 'active' : ''} disabled>Follow-up</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {consentStatus !== 'unknown' && (
              <span className={`chip ${consentStatus === 'on_file' ? 'pkg' : 'pending'}`}>
                {consentStatus === 'on_file' ? 'Consent on file' : 'No consent on record'}
              </span>
            )}
            <span className={`note-status-chip ${status === 'completed' ? 'completed' : ''}`}>
              {status === 'completed' ? 'Completed' : 'Draft'}
            </span>
          </div>
        </div>

        {patient && (
          <div className="pheader" style={{ padding: 0, boxShadow: 'none', background: 'none' }}>
            <div className="avatar">{initials}</div>
            <div style={{ flex: 1 }}>
              <div className="pname-row"><span className="pname">{patient.name}</span></div>
              <div className="pmeta">{patient.mrno} · {patient.age ?? '—'}{patient.sex ?? ''}</div>
              <div className="ne-episode">{episodeLine}</div>
            </div>
          </div>
        )}

        {/* General Health & Triage — moved up near basic info (§1), not part
            of the accordion, always visible/editable regardless of note mode. */}
        <div className="setup-card">
          <p className="section-label" style={{ margin: '0 0 8px' }}>General health &amp; triage</p>
          <div className="field-row">
            <div className="field-block">
              <label>Weight (kg)</label>
              <input
                type="number"
                value={payload.generalHealth?.weightKg ?? ''}
                disabled={readOnly}
                onChange={(e) => update('generalHealth', { ...payload.generalHealth, weightKg: e.target.value ? Number(e.target.value) : undefined, vitals: payload.generalHealth?.vitals ?? [] })}
              />
            </div>
            <div className="field-block">
              <label>Height (cm)</label>
              <input
                type="number"
                value={payload.generalHealth?.heightCm ?? ''}
                disabled={readOnly}
                onChange={(e) => update('generalHealth', { ...payload.generalHealth, heightCm: e.target.value ? Number(e.target.value) : undefined, vitals: payload.generalHealth?.vitals ?? [] })}
              />
            </div>
          </div>
          <div className="field-row" style={{ marginTop: 10 }}>
            <div className="field-block">
              <label>Waist (cm)</label>
              <input
                type="number"
                value={payload.generalHealth?.waistCm ?? ''}
                disabled={readOnly}
                onChange={(e) => update('generalHealth', { ...payload.generalHealth, waistCm: e.target.value ? Number(e.target.value) : undefined, vitals: payload.generalHealth?.vitals ?? [] })}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {bmi !== null && <div className="derived-value">BMI {bmi}</div>}
              {waistToHeight !== null && <div className="derived-value">Waist/height {waistToHeight}</div>}
            </div>
          </div>
        </div>

        <div className={`screening-banner ${derived.redFlagCount > 0 ? 'red' : derived.yellowConcernCount > 0 ? 'amber' : 'clear'} ${screeningOpen ? 'open' : ''}`}>
          <button type="button" className="sb-head" onClick={() => setScreeningOpen((v) => !v)}>
            <span>
              🛡 Screening — {derived.redFlagCount > 0
                ? `${derived.redFlagCount} red flag${derived.redFlagCount > 1 ? 's' : ''}`
                : derived.yellowConcernCount > 0
                  ? `${derived.yellowConcernCount} concern${derived.yellowConcernCount > 1 ? 's' : ''}`
                  : 'All clear ✓'}
            </span>
            <span className="chev">›</span>
          </button>
          <div className="sb-body">
            <button
              type="button"
              className="sb-bulk-btn"
              disabled={readOnly}
              onClick={() =>
                update('screening', {
                  ...payload.screening,
                  redFlags: Object.fromEntries(RED_FLAG_ITEMS.map((r) => [r, 'no'])) as CoreAssessmentPayload['screening']['redFlags'],
                  bulkCleared: true,
                })
              }
            >
              No red flags — all clear
            </button>
            <p className="section-label">Red flags</p>
            <div className="flag-row">
              {RED_FLAG_ITEMS.map((item) => (
                <RedFlagPill
                  key={item}
                  item={item}
                  state={payload.screening.redFlags[item]}
                  onChange={(next) =>
                    update('screening', {
                      ...payload.screening,
                      redFlags: { ...payload.screening.redFlags, [item]: next },
                      bulkCleared: false,
                    })
                  }
                />
              ))}
            </div>
            {payload.screening.bulkCleared && <p className="sb-provenance">Cleared via bulk action — not individually assessed per flag.</p>}
            <p className="section-label" style={{ marginTop: 12 }}>Yellow flags</p>
            <div className="flag-row">
              {YELLOW_FLAG_ITEMS.map((item) => (
                <YellowFlagPill
                  key={item}
                  item={item}
                  state={payload.screening.yellowFlags[item]}
                  onChange={(next) => update('screening', { ...payload.screening, yellowFlags: { ...payload.screening.yellowFlags, [item]: next } })}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Same card treatment as General health & triage above -- without
            it this was a bare label+select floating between the screening
            banner and the jump-nav/accordion split, the only piece of the
            page with no visual boundary of its own. */}
        <div className="setup-card">
          <div className="field-block">
            <label>Therapist</label>
            <select value={therapistId} onChange={(e) => setTherapistId(e.target.value)} disabled={readOnly}>
              {(therapists ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
        </div>

        {noteMode === 'followup' && ready && !priorNoteHasCarryForwardData && (
          <div
            className="rounded-md px-3 py-2 text-xs"
            style={{ background: 'var(--slate-light)', color: 'var(--slate)', marginBottom: 12 }}
          >
            This is a follow-up visit, but there's no usable prior Chief Complaint/History data to
            carry forward — a data gap, or the first note on record for this episode. Chief
            Complaint and History start blank below rather than silently showing empty as if it
            were meant that way.
          </div>
        )}

        <div className="md:flex md:items-start md:gap-6">
          <nav className="hidden md:sticky md:top-20 md:flex md:max-h-[calc(100vh-6rem)] md:w-52 md:shrink-0 md:flex-col md:gap-0.5 md:overflow-y-auto">
            {SECTION_GROUPS.map((group) => {
              // Outcome Tracking only exists once there's prior data to
              // compare against — drop its whole group rather than leave a
              // heading with nothing under it.
              const keys = group.keys.filter((key) => key !== 'outcome' || outcomeCards.length > 0);
              if (keys.length === 0) return null;
              return (
                <div key={group.label} className="mb-1.5 last:mb-0">
                  <p className="px-3 pb-1 pt-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]/70">
                    {group.label}
                  </p>
                  {keys.map((key) => {
                    const completion = sectionCompletion(key, payload);
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => jumpToSection(key)}
                        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-xs font-medium"
                        style={{
                          background: activeSection === key ? 'var(--teal-light)' : 'transparent',
                          color: activeSection === key ? 'var(--teal)' : 'var(--muted)',
                        }}
                      >
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: STATUS_DOT[completion] }} />
                        {SECTION_LABELS[key]}
                      </button>
                    );
                  })}
                </div>
              );
            })}
            <button
              type="button"
              onClick={toggleCollapseAll}
              className="mt-2 shrink-0 px-3 text-left text-xs text-[var(--teal)] hover:underline"
            >
              {openSections.size > 0 ? 'Collapse all' : 'Expand all'}
            </button>
          </nav>

          <div className="setup-accordion min-w-0 flex-1">

        {/* 1. Chief Complaint */}
        <div
          ref={(el) => {
            if (el) sectionRefs.current.set('chiefComplaint', el);
            else sectionRefs.current.delete('chiefComplaint');
          }}
          className={`setup-section scroll-mt-20 ${openSections.has('chiefComplaint') ? 'open' : ''}`}
        >
          <button type="button" className="setup-section-head" onClick={() => toggleSection('chiefComplaint')}>
            <div>
              <h3>
                Chief Complaint
                {isCollapsed('chiefComplaint') && (
                  <span style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                    <Pill tone="slate">Carried forward</Pill>
                  </span>
                )}
              </h3>
              <div className="sub">Region, timeline, occupation/activity context</div>
            </div>
            <span className="chev">›</span>
          </button>
          <div className="setup-section-body">
          <div className="field-block">
            <label>Anatomical region *</label>
            <select
              required
              value={region}
              disabled={readOnly}
              onChange={(e) => update('chiefComplaint', { ...payload.chiefComplaint, anatomicalRegion: e.target.value as CoreAssessmentPayload['chiefComplaint']['anatomicalRegion'] })}
            >
              <option value="">Select region…</option>
              {ANATOMICAL_REGIONS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          {isCollapsed('chiefComplaint') ? (
            <CarryForward
              summary={`${payload.chiefComplaint.onset || 'onset not set'}${payload.chiefComplaint.primaryComplaint.length ? ' · ' + payload.chiefComplaint.primaryComplaint.join(', ') : ''}`}
              onUpdate={() => expand('chiefComplaint')}
            />
          ) : (
            <div className="initial-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field-block" style={{ margin: 0 }}>
                <label>Presenting problem</label>
                <textarea
                  value={payload.chiefComplaint.presentingProblem}
                  disabled={readOnly}
                  onChange={(e) => update('chiefComplaint', { ...payload.chiefComplaint, presentingProblem: e.target.value })}
                />
              </div>
              <div className="field-block" style={{ margin: 0 }}>
                <label>Primary complaint</label>
                <MultiToggle
                  options={['Pain', 'Stiffness', 'Weakness', 'Instability', 'Numbness/tingling', 'Swelling']}
                  value={payload.chiefComplaint.primaryComplaint}
                  onChange={(v) => update('chiefComplaint', { ...payload.chiefComplaint, primaryComplaint: v })}
                />
              </div>

              <p className="section-label" style={{ marginTop: 4 }}>Contextual timeline</p>
              <div className="field-block" style={{ margin: 0 }}>
                <label>Onset</label>
                <select
                  value={payload.chiefComplaint.onset}
                  disabled={readOnly}
                  onChange={(e) => update('chiefComplaint', { ...payload.chiefComplaint, onset: e.target.value as CoreAssessmentPayload['chiefComplaint']['onset'] })}
                >
                  <option value="">—</option>
                  <option value="acute-trauma">Acute trauma</option>
                  <option value="gradual-overuse">Gradual overuse</option>
                  <option value="insidious-no-trigger">Insidious — no trigger</option>
                  <option value="post-surgical">Post-surgical</option>
                </select>
              </div>
              {payload.chiefComplaint.onset === 'post-surgical' && (
                <div className="field-row">
                  <div className="field-block">
                    <label>Surgery type</label>
                    <input
                      value={payload.chiefComplaint.postSurgical?.surgeryType ?? ''}
                      disabled={readOnly}
                      onChange={(e) =>
                        update('chiefComplaint', {
                          ...payload.chiefComplaint,
                          postSurgical: { surgeryType: e.target.value, surgeryDate: payload.chiefComplaint.postSurgical?.surgeryDate ?? '', postOpWeek: payload.chiefComplaint.postSurgical?.postOpWeek ?? null },
                        })
                      }
                    />
                  </div>
                  <div className="field-block">
                    <label>Surgery date</label>
                    <input
                      type="date"
                      value={payload.chiefComplaint.postSurgical?.surgeryDate ?? ''}
                      disabled={readOnly}
                      onChange={(e) => {
                        const surgeryDate = e.target.value;
                        const postOpWeek = surgeryDate
                          ? Math.floor((Date.now() - new Date(surgeryDate).getTime()) / (7 * 24 * 3600 * 1000))
                          : null;
                        update('chiefComplaint', {
                          ...payload.chiefComplaint,
                          postSurgical: { surgeryType: payload.chiefComplaint.postSurgical?.surgeryType ?? '', surgeryDate, postOpWeek },
                        });
                      }}
                    />
                  </div>
                </div>
              )}
              <div className="field-block" style={{ margin: 0 }}>
                <label>Mechanism of injury</label>
                <input
                  value={payload.chiefComplaint.mechanism ?? ''}
                  disabled={readOnly}
                  onChange={(e) => update('chiefComplaint', { ...payload.chiefComplaint, mechanism: e.target.value })}
                />
              </div>
              <div className="field-row">
                <div className="field-block">
                  <label>Episode pattern</label>
                  <select
                    value={payload.chiefComplaint.episodePattern}
                    disabled={readOnly}
                    onChange={(e) => update('chiefComplaint', { ...payload.chiefComplaint, episodePattern: e.target.value as CoreAssessmentPayload['chiefComplaint']['episodePattern'] })}
                  >
                    <option value="">—</option>
                    <option value="first-episode">First episode</option>
                    <option value="recurrent-episodes">Recurrent</option>
                    <option value="chronic-ongoing">Chronic ongoing</option>
                    <option value="post-surgical">Post-surgical</option>
                  </select>
                </div>
                <div className="field-block">
                  <label>Trend</label>
                  <select
                    value={payload.chiefComplaint.trend}
                    disabled={readOnly}
                    onChange={(e) => update('chiefComplaint', { ...payload.chiefComplaint, trend: e.target.value as CoreAssessmentPayload['chiefComplaint']['trend'] })}
                  >
                    <option value="">—</option>
                    <option value="improving">Improving</option>
                    <option value="stable">Stable</option>
                    <option value="worsening">Worsening</option>
                    <option value="fluctuating">Fluctuating</option>
                  </select>
                </div>
              </div>

              <p className="section-label" style={{ marginTop: 4 }}>Occupation &amp; activity</p>
              <div className="field-row">
                <div className="field-block">
                  <label>Occupation</label>
                  <select
                    value={payload.chiefComplaint.occupation}
                    disabled={readOnly}
                    onChange={(e) => update('chiefComplaint', { ...payload.chiefComplaint, occupation: e.target.value })}
                  >
                    <option value="">—</option>
                    {OCCUPATION_GROUPS.map((g) => (
                      <optgroup key={g.group} label={g.group}>
                        {g.options.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <div className="field-block">
                  <label>Activity / sports</label>
                  <select
                    value={payload.chiefComplaint.activity}
                    disabled={readOnly}
                    onChange={(e) => update('chiefComplaint', { ...payload.chiefComplaint, activity: e.target.value })}
                  >
                    <option value="">—</option>
                    {ACTIVITY_GROUPS.map((g) => (
                      <optgroup key={g.group} label={g.group}>
                        {g.options.map((o) => (
                          <option key={o} value={o}>{o}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field-block" style={{ margin: 0 }}>
                <label>Job/role (specifics)</label>
                <input
                  value={payload.chiefComplaint.jobRole ?? ''}
                  disabled={readOnly}
                  onChange={(e) => update('chiefComplaint', { ...payload.chiefComplaint, jobRole: e.target.value })}
                />
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)' }}>Secondary complaints</label>
                  <button
                    className="btn-secondary"
                    disabled={readOnly}
                    onClick={() => {
                      const newId = Math.random().toString(36).substr(2, 9);
                      update('chiefComplaint', {
                        ...payload.chiefComplaint,
                        secondaryComplaints: [...(payload.chiefComplaint.secondaryComplaints || []), { id: newId, region: '' }]
                      });
                    }}
                  >
                    + Add
                  </button>
                </div>
                {!payload.chiefComplaint.secondaryComplaints || payload.chiefComplaint.secondaryComplaints.length === 0 ? (
                  <p className="empty-note">No secondary complaints added.</p>
                ) : (
                  payload.chiefComplaint.secondaryComplaints.map((complaint) => (
                    <div key={complaint.id} className="setup-card" style={{ marginBottom: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          placeholder="Region"
                          value={complaint.region}
                          disabled={readOnly}
                          onChange={(e) =>
                            update('chiefComplaint', {
                              ...payload.chiefComplaint,
                              secondaryComplaints: payload.chiefComplaint.secondaryComplaints?.map((x) => (x.id === complaint.id ? { ...x, region: e.target.value } : x))
                            })
                          }
                          style={{ flex: 1 }}
                        />
                        <button
                          className="kebab"
                          disabled={readOnly}
                          onClick={() =>
                            update('chiefComplaint', {
                              ...payload.chiefComplaint,
                              secondaryComplaints: payload.chiefComplaint.secondaryComplaints?.filter((x) => x.id !== complaint.id)
                            })
                          }
                        >
                          ✕
                        </button>
                      </div>
                      <div className="field-row">
                        <input
                          placeholder="Onset"
                          value={complaint.onset ?? ''}
                          disabled={readOnly}
                          onChange={(e) =>
                            update('chiefComplaint', {
                              ...payload.chiefComplaint,
                              secondaryComplaints: payload.chiefComplaint.secondaryComplaints?.map((x) => (x.id === complaint.id ? { ...x, onset: e.target.value } : x))
                            })
                          }
                        />
                        <input
                          placeholder="Mechanism"
                          value={complaint.mechanism ?? ''}
                          disabled={readOnly}
                          onChange={(e) =>
                            update('chiefComplaint', {
                              ...payload.chiefComplaint,
                              secondaryComplaints: payload.chiefComplaint.secondaryComplaints?.map((x) => (x.id === complaint.id ? { ...x, mechanism: e.target.value } : x))
                            })
                          }
                        />
                      </div>
                      <input
                        placeholder="Episode pattern"
                        value={complaint.episodePattern ?? ''}
                        disabled={readOnly}
                        onChange={(e) =>
                          update('chiefComplaint', {
                            ...payload.chiefComplaint,
                            secondaryComplaints: payload.chiefComplaint.secondaryComplaints?.map((x) => (x.id === complaint.id ? { ...x, episodePattern: e.target.value } : x))
                          })
                        }
                      />
                      <input
                        placeholder="Notes"
                        value={complaint.note ?? ''}
                        disabled={readOnly}
                        onChange={(e) =>
                          update('chiefComplaint', {
                            ...payload.chiefComplaint,
                            secondaryComplaints: payload.chiefComplaint.secondaryComplaints?.map((x) => (x.id === complaint.id ? { ...x, note: e.target.value } : x))
                          })
                        }
                      />
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          </div>
        </div>

        {/* 2. History */}
        <div
          ref={(el) => {
            if (el) sectionRefs.current.set('history', el);
            else sectionRefs.current.delete('history');
          }}
          className={`setup-section scroll-mt-20 ${openSections.has('history') ? 'open' : ''}`}
        >
          <button type="button" className="setup-section-head" onClick={() => toggleSection('history')}>
            <div>
              <h3>
                Medical, Trauma &amp; Surgical History
                {isCollapsed('history') && (
                  <span style={{ marginLeft: 8, verticalAlign: 'middle' }}>
                    <Pill tone="slate">Carried forward</Pill>
                  </span>
                )}
              </h3>
              <div className="sub">Conditions, safety flags, past trauma/surgery</div>
            </div>
            <span className="chev">›</span>
          </button>
          <div className="setup-section-body">
          {isCollapsed('history') ? (
            <CarryForward
              summary={payload.history.medicalConditions.length ? payload.history.medicalConditions.join(', ') : 'No comorbidities on file'}
              onUpdate={() => expand('history')}
            />
          ) : (
            <div className="initial-only" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="field-block" style={{ margin: 0 }}>
                <label>Medical conditions</label>
                <MultiToggle
                  options={['Diabetes', 'Hypertension', 'Cardiac', 'Respiratory', 'Osteoporosis', 'Arthritis', 'Cancer', 'Neurological', 'Mental health', 'Autoimmune', 'Blood disorder']}
                  value={payload.history.medicalConditions}
                  onChange={(v) => update('history', { ...payload.history, medicalConditions: v })}
                />
              </div>
              <div className="field-row">
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input
                    type="checkbox"
                    checked={payload.history.anticoagulant.onBloodThinner}
                    disabled={readOnly}
                    onChange={(e) => update('history', { ...payload.history, anticoagulant: { onBloodThinner: e.target.checked } })}
                  />
                  On blood thinner
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                  <input
                    type="checkbox"
                    checked={payload.history.implants.present}
                    disabled={readOnly}
                    onChange={(e) => update('history', { ...payload.history, implants: { present: e.target.checked } })}
                  />
                  Implants / pacemaker
                </label>
              </div>
              <div className="field-block" style={{ margin: 0 }}>
                <label>Pregnant</label>
                <select
                  value={payload.history.pregnancyStatus}
                  disabled={readOnly}
                  onChange={(e) => update('history', { ...payload.history, pregnancyStatus: e.target.value as CoreAssessmentPayload['history']['pregnancyStatus'] })}
                >
                  <option value="not-applicable">Not applicable</option>
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </div>
              <div className="field-row">
                <div className="field-block">
                  <label>Current medications</label>
                  <input value={payload.history.medications} disabled={readOnly} onChange={(e) => update('history', { ...payload.history, medications: e.target.value })} />
                </div>
                <div className="field-block">
                  <label>Allergies</label>
                  <input value={payload.history.allergies} disabled={readOnly} onChange={(e) => update('history', { ...payload.history, allergies: e.target.value })} />
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)' }}>Trauma history</label>
                  <button className="btn-secondary" disabled={readOnly} onClick={() => update('history', { ...payload.history, traumas: [...payload.history.traumas, { date: '', bodyPart: '', nature: '', treatment: '', sequelae: 'none' }] })}>+ Add</button>
                </div>
                {payload.history.traumas.map((t, i) => (
                  <div key={i} className="field-row" style={{ marginTop: 6, alignItems: 'center', gridTemplateColumns: '90px 1fr 1fr auto' }}>
                    <input type="text" placeholder="Date/year" value={t.date} disabled={readOnly} onChange={(e) => update('history', { ...payload.history, traumas: payload.history.traumas.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
                    <input placeholder="Body part" value={t.bodyPart} disabled={readOnly} onChange={(e) => update('history', { ...payload.history, traumas: payload.history.traumas.map((x, j) => (j === i ? { ...x, bodyPart: e.target.value } : x)) })} />
                    <input placeholder="Nature" value={t.nature} disabled={readOnly} onChange={(e) => update('history', { ...payload.history, traumas: payload.history.traumas.map((x, j) => (j === i ? { ...x, nature: e.target.value } : x)) })} />
                    <button className="kebab" disabled={readOnly} onClick={() => update('history', { ...payload.history, traumas: payload.history.traumas.filter((_, j) => j !== i) })}>✕</button>
                  </div>
                ))}
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)' }}>Surgical history</label>
                  <button className="btn-secondary" disabled={readOnly} onClick={() => update('history', { ...payload.history, surgeries: [...payload.history.surgeries, { date: '', procedure: '', outcome: 'good', currentStatus: 'recovered' }] })}>+ Add</button>
                </div>
                {payload.history.surgeries.map((s, i) => (
                  <div key={i} className="field-row" style={{ marginTop: 6, alignItems: 'center', gridTemplateColumns: '90px 1fr 1fr auto' }}>
                    <input type="text" placeholder="Date/year" value={s.date} disabled={readOnly} onChange={(e) => update('history', { ...payload.history, surgeries: payload.history.surgeries.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
                    <input placeholder="Procedure" value={s.procedure} disabled={readOnly} onChange={(e) => update('history', { ...payload.history, surgeries: payload.history.surgeries.map((x, j) => (j === i ? { ...x, procedure: e.target.value } : x)) })} />
                    <select value={s.outcome} disabled={readOnly} onChange={(e) => update('history', { ...payload.history, surgeries: payload.history.surgeries.map((x, j) => (j === i ? { ...x, outcome: e.target.value as typeof x.outcome } : x)) })}>
                      <option value="good">Good</option>
                      <option value="fair">Fair</option>
                      <option value="poor">Poor</option>
                    </select>
                    <button className="kebab" disabled={readOnly} onClick={() => update('history', { ...payload.history, surgeries: payload.history.surgeries.filter((_, j) => j !== i) })}>✕</button>
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)' }}>Previous pain history</label>
                  <button
                    className="btn-secondary"
                    disabled={readOnly}
                    onClick={() => {
                      const newId = Math.random().toString(36).substr(2, 9);
                      update('history', {
                        ...payload.history,
                        previousPainHistory: [...(payload.history.previousPainHistory || []), { id: newId, region: '' }]
                      });
                    }}
                  >
                    + Add
                  </button>
                </div>
                {!payload.history.previousPainHistory || payload.history.previousPainHistory.length === 0 ? (
                  <p className="empty-note">No previous pain history added.</p>
                ) : (
                  payload.history.previousPainHistory.map((entry) => (
                    <div key={entry.id} className="setup-card" style={{ marginBottom: 8, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input
                          placeholder="Region"
                          value={entry.region}
                          disabled={readOnly}
                          onChange={(e) =>
                            update('history', {
                              ...payload.history,
                              previousPainHistory: payload.history.previousPainHistory?.map((x) => (x.id === entry.id ? { ...x, region: e.target.value } : x))
                            })
                          }
                          style={{ flex: 1 }}
                        />
                        <button
                          className="kebab"
                          disabled={readOnly}
                          onClick={() =>
                            update('history', {
                              ...payload.history,
                              previousPainHistory: payload.history.previousPainHistory?.filter((x) => x.id !== entry.id)
                            })
                          }
                        >
                          ✕
                        </button>
                      </div>
                      <div className="field-row">
                        <input
                          placeholder="Timeline onset"
                          value={entry.timelineOnset ?? ''}
                          disabled={readOnly}
                          onChange={(e) =>
                            update('history', {
                              ...payload.history,
                              previousPainHistory: payload.history.previousPainHistory?.map((x) => (x.id === entry.id ? { ...x, timelineOnset: e.target.value } : x))
                            })
                          }
                        />
                        <input
                          placeholder="Timeline duration"
                          value={entry.timelineDuration ?? ''}
                          disabled={readOnly}
                          onChange={(e) =>
                            update('history', {
                              ...payload.history,
                              previousPainHistory: payload.history.previousPainHistory?.map((x) => (x.id === entry.id ? { ...x, timelineDuration: e.target.value } : x))
                            })
                          }
                        />
                      </div>
                      <div className="field-row">
                        <select
                          value={entry.intensity ?? ''}
                          disabled={readOnly}
                          onChange={(e) =>
                            update('history', {
                              ...payload.history,
                              previousPainHistory: payload.history.previousPainHistory?.map((x) => (x.id === entry.id ? { ...x, intensity: (e.target.value || undefined) as typeof entry.intensity } : x))
                            })
                          }
                        >
                          <option value="">—</option>
                          <option value="mild">Mild</option>
                          <option value="moderate">Moderate</option>
                          <option value="severe">Severe</option>
                        </select>
                        <input
                          placeholder="Treatment"
                          value={entry.treatment ?? ''}
                          disabled={readOnly}
                          onChange={(e) =>
                            update('history', {
                              ...payload.history,
                              previousPainHistory: payload.history.previousPainHistory?.map((x) => (x.id === entry.id ? { ...x, treatment: e.target.value } : x))
                            })
                          }
                        />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          </div>
        </div>

        {/* 4. Subjective — Pain Profile + Body chart */}
        <div
          ref={(el) => {
            if (el) sectionRefs.current.set('subjective', el);
            else sectionRefs.current.delete('subjective');
          }}
          className={`setup-section scroll-mt-20 ${openSections.has('subjective') ? 'open' : ''}`}
        >
          <button type="button" className="setup-section-head" onClick={() => toggleSection('subjective')}>
            <div><h3>Subjective</h3><div className="sub">Body chart, pain profile</div></div>
            <span className="chev">›</span>
          </button>
          <div className="setup-section-body">
          <p className="section-label">Pain profile</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="field-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div>
                <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)' }}>Current</label>
                <ScaleWidget
                  variant="nrs"
                  value={payload.painProfile.nrs.current}
                  onChange={(n) => update('painProfile', { ...payload.painProfile, nrs: { ...payload.painProfile.nrs, current: n } })}
                  endpoints={['No pain', 'Worst imaginable']}
                  disabled={readOnly}
                />
              </div>
              <div>
                <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)' }}>Best</label>
                <ScaleWidget
                  variant="nrs"
                  value={payload.painProfile.nrs.best}
                  onChange={(n) => update('painProfile', { ...payload.painProfile, nrs: { ...payload.painProfile.nrs, best: n } })}
                  endpoints={['No pain', 'Worst imaginable']}
                  disabled={readOnly}
                />
              </div>
              <div>
                <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)' }}>Worst</label>
                <ScaleWidget
                  variant="nrs"
                  value={payload.painProfile.nrs.worst}
                  onChange={(n) => update('painProfile', { ...payload.painProfile, nrs: { ...payload.painProfile.nrs, worst: n } })}
                  endpoints={['No pain', 'Worst imaginable']}
                  disabled={readOnly}
                />
              </div>
            </div>
            <div className="field-row">
              <div className="field-block">
                <label>Pattern</label>
                <select value={payload.painProfile.pattern} disabled={readOnly} onChange={(e) => update('painProfile', { ...payload.painProfile, pattern: e.target.value as CoreAssessmentPayload['painProfile']['pattern'] })}>
                  <option value="">—</option>
                  <option value="constant">Constant</option>
                  <option value="intermittent">Intermittent</option>
                  <option value="night-only">Night only</option>
                  <option value="morning-stiffness">Morning stiffness &gt;30min</option>
                </select>
              </div>
              <div className="field-block">
                <label>Sleep disturbed</label>
                <select value={payload.painProfile.sleepDisturbed} disabled={readOnly} onChange={(e) => update('painProfile', { ...payload.painProfile, sleepDisturbed: e.target.value as CoreAssessmentPayload['painProfile']['sleepDisturbed'] })}>
                  <option value="">—</option>
                  <option value="no">No</option>
                  <option value="wakes-occasionally">Wakes occasionally</option>
                  <option value="cannot-return-to-sleep">Cannot return to sleep</option>
                </select>
              </div>
            </div>
            <div className="field-row">
              <div className="field-block">
                <label>Aggravating</label>
                <input value={payload.painProfile.aggravating} disabled={readOnly} onChange={(e) => update('painProfile', { ...payload.painProfile, aggravating: e.target.value })} />
              </div>
              <div className="field-block">
                <label>Easing</label>
                <input value={payload.painProfile.easing} disabled={readOnly} onChange={(e) => update('painProfile', { ...payload.painProfile, easing: e.target.value })} />
              </div>
            </div>
          </div>

          <p className="section-label" style={{ marginTop: 14 }}>Body chart</p>
          <BodyChart
            marks={payload.bodyChart.marks}
            onChange={(marks) => update('bodyChart', { ...payload.bodyChart, marks })}
            disabled={readOnly}
          />
          </div>
        </div>

        {/* 5. Functional Status (PSFS) */}
        <div
          ref={(el) => {
            if (el) sectionRefs.current.set('psfs', el);
            else sectionRefs.current.delete('psfs');
          }}
          className={`setup-section scroll-mt-20 ${openSections.has('psfs') ? 'open' : ''}`}
        >
          <button type="button" className="setup-section-head" onClick={() => toggleSection('psfs')}>
            <div><h3>Functional Status (PSFS)</h3><div className="sub">{payload.functionalStatus.activities.length} activit{payload.functionalStatus.activities.length === 1 ? 'y' : 'ies'} tracked</div></div>
            <span className="chev">›</span>
          </button>
          <div className="setup-section-body">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <p className="section-label" style={{ margin: 0 }}>
              PSFS {derived.psfsMean !== null && <span className="chip pkg" style={{ marginLeft: 6 }}>current mean {derived.psfsMean}</span>}
              {payload.functionalStatus.activities.length > 0 && (
                <span className="chip pending" style={{ marginLeft: 6 }}>{psfsImproving} of {payload.functionalStatus.activities.length} crossed MCID</span>
              )}
            </p>
            <button
              className="btn-secondary"
              disabled={readOnly || payload.functionalStatus.activities.length >= 5}
              onClick={() =>
                update('functionalStatus', {
                  activities: [...payload.functionalStatus.activities, { label: '', baseline: 5, baselineDate: new Date().toISOString().slice(0, 10), current: 5 }],
                })
              }
            >
              + Activity
            </button>
          </div>
          {payload.functionalStatus.activities.length === 0 && <p className="empty-note">No activities added.</p>}
          {payload.functionalStatus.activities.map((a, i) => (
            <div className="setup-card" key={i} style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  style={{ flex: 1, background: 'var(--paper)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 13 }}
                  placeholder="Activity (e.g. climbing stairs)"
                  value={a.label}
                  disabled={readOnly}
                  onChange={(e) =>
                    update('functionalStatus', {
                      activities: payload.functionalStatus.activities.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)),
                    })
                  }
                />
                <button className="kebab" disabled={readOnly} onClick={() => update('functionalStatus', { activities: payload.functionalStatus.activities.filter((_, j) => j !== i) })}>✕</button>
              </div>
              <div>
                <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)' }}>
                  Baseline ({a.baselineDate})
                </label>
                <ScaleWidget
                  variant="psfs"
                  value={a.baseline}
                  onChange={(n) => update('functionalStatus', { activities: payload.functionalStatus.activities.map((x, j) => (j === i ? { ...x, baseline: n } : x)) })}
                  endpoints={['Cannot do at all', 'Pre-injury level']}
                  disabled={readOnly}
                />
              </div>
              <div>
                <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)' }}>Current</label>
                <ScaleWidget
                  variant="psfs"
                  value={a.current}
                  onChange={(n) => update('functionalStatus', { activities: payload.functionalStatus.activities.map((x, j) => (j === i ? { ...x, current: n } : x)) })}
                  endpoints={['Cannot do at all', 'Pre-injury level']}
                  disabled={readOnly}
                />
              </div>
            </div>
          ))}
          </div>
        </div>

        {/* 6. Objective */}
        <div
          ref={(el) => {
            if (el) sectionRefs.current.set('objective', el);
            else sectionRefs.current.delete('objective');
          }}
          className={`setup-section scroll-mt-20 ${openSections.has('objective') ? 'open' : ''}`}
        >
          <button type="button" className="setup-section-head" onClick={() => toggleSection('objective')}>
            <div>
              <h3>Objective</h3>
              <div className="sub">{noteMode === 'followup' ? 'Tracked measures only' : 'Full battery — gait, posture, palpation, neuro, ROM, MMT, special tests'}</div>
            </div>
            <span className="chev">›</span>
          </button>
          <div className="setup-section-body">
          <div className="initial-only">
          <p className="section-label">Gait</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
            <MultiToggle
              options={['Normal', 'Limping/Antalgic', 'Trendelenburg', 'Ataxic', 'Wide-based', 'Shuffling', 'Circumduction']}
              value={payload.gaitPosture.gait}
              onChange={(v) => update('gaitPosture', { ...payload.gaitPosture, gait: v })}
            />
            <div className="field-block" style={{ margin: 0 }}>
              <label>Assistive device</label>
              <input value={payload.gaitPosture.assistiveDevice} disabled={readOnly} onChange={(e) => update('gaitPosture', { ...payload.gaitPosture, assistiveDevice: e.target.value })} />
            </div>
          </div>

          <p className="section-label">Posture</p>
          <div style={{ marginBottom: 14 }}>
            <MultiToggle
              options={['Normal', 'Forward head', 'Rounded shoulders', 'Increased kyphosis', 'Increased lordosis', 'Scoliosis', 'Pelvic tilt (anterior)', 'Pelvic tilt (posterior)', 'Shoulder asymmetry', 'Genu valgum', 'Genu varum']}
              value={payload.gaitPosture.posture}
              onChange={(v) => update('gaitPosture', { ...payload.gaitPosture, posture: v })}
            />
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p className="section-label" style={{ margin: 0 }}>Palpation</p>
            <button className="btn-secondary" disabled={readOnly} onClick={() => update('palpation', [...payload.palpation, { region: '', findings: [], painOnPalpation: 'none', notes: '' }])}>+ Add</button>
          </div>
          {payload.palpation.map((p, i) => (
            <div className="setup-card" key={i} style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input style={{ flex: 1 }} placeholder="Region" value={p.region} disabled={readOnly} onChange={(e) => update('palpation', payload.palpation.map((x, j) => (j === i ? { ...x, region: e.target.value } : x)))} />
                <select value={p.painOnPalpation} disabled={readOnly} onChange={(e) => update('palpation', payload.palpation.map((x, j) => (j === i ? { ...x, painOnPalpation: e.target.value as typeof x.painOnPalpation } : x)))}>
                  <option value="none">None</option>
                  <option value="mild">Mild</option>
                  <option value="moderate">Moderate</option>
                  <option value="severe">Severe</option>
                </select>
                <button className="kebab" disabled={readOnly} onClick={() => update('palpation', payload.palpation.filter((_, j) => j !== i))}>✕</button>
              </div>
              <MultiToggle
                options={['Tenderness', 'Muscle spasm', 'Trigger points', 'Swelling', 'Warmth', 'Crepitus']}
                value={p.findings}
                onChange={(v) => update('palpation', payload.palpation.map((x, j) => (j === i ? { ...x, findings: v } : x)))}
              />
            </div>
          ))}
        </div>

        <div className="initial-only">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <p className="section-label" style={{ margin: 0 }}>Neurological screen</p>
            <button type="button" className="btn-secondary" disabled={readOnly} onClick={() => {
              const dermatomes = Object.fromEntries(NEURO_LEVELS.map((l) => [l, 'normal'])) as CoreAssessmentPayload['neurologicalScreen']['dermatomes'];
              const myotomes = Object.fromEntries(NEURO_LEVELS.map((l) => [l, 'normal'])) as CoreAssessmentPayload['neurologicalScreen']['myotomes'];
              update('neurologicalScreen', { ...payload.neurologicalScreen, dermatomes, myotomes });
            }}>
              Mark all WNL
            </button>
          </div>
          {!showNeuroTable ? (
            <div className="carry-forward" style={{ marginTop: 8 }}>
              All levels within normal limits.
              <button className="cf-update" onClick={() => setNeuroExpanded(true)}>Expand</button>
            </div>
          ) : (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table className="mini-table">
              <thead>
                <tr><th>Level</th><th>Dermatome</th><th>Myotome</th></tr>
              </thead>
              <tbody>
                {NEURO_LEVELS.map((level: NeuroLevel) => (
                  <tr key={level}>
                    <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{level}</td>
                    <td>
                      <select
                        value={payload.neurologicalScreen.dermatomes[level] ?? 'not-tested'}
                        disabled={readOnly}
                        onChange={(e) => update('neurologicalScreen', { ...payload.neurologicalScreen, dermatomes: { ...payload.neurologicalScreen.dermatomes, [level]: e.target.value as DermatomeResult } })}
                      >
                        <option value="not-tested">Not tested</option>
                        <option value="normal">Normal</option>
                        <option value="reduced">Reduced</option>
                        <option value="absent">Absent</option>
                        <option value="hypersensitive">Hypersensitive</option>
                      </select>
                    </td>
                    <td>
                      <select
                        value={payload.neurologicalScreen.myotomes[level] ?? 'not-tested'}
                        disabled={readOnly}
                        onChange={(e) => update('neurologicalScreen', { ...payload.neurologicalScreen, myotomes: { ...payload.neurologicalScreen.myotomes, [level]: e.target.value as MyotomeResult } })}
                      >
                        <option value="not-tested">Not tested</option>
                        <option value="normal">Normal</option>
                        <option value="reduced">Reduced</option>
                        <option value="absent">Absent</option>
                      </select>
                      {payload.objective.strength
                        .filter((s) => s.nerveRoot === level && s.grade !== 'not-tested')
                        .map((s, si) => (
                          <div className="derived-value" key={si}>
                            ⓘ Graded {s.grade} in Strength ({s.movement || 'untitled'}{s.side ? `, ${s.side}` : ''}) — derived, read-only
                          </div>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="mini-table" style={{ marginTop: 10 }}>
              <thead><tr><th>Reflex</th><th>Result</th></tr></thead>
              <tbody>
                {REFLEX_ITEMS.map((item: ReflexItem) => (
                  <tr key={item}>
                    <td>{item}</td>
                    <td>
                      <select
                        value={payload.neurologicalScreen.reflexes[item] ?? 'not-tested'}
                        disabled={readOnly}
                        onChange={(e) => update('neurologicalScreen', { ...payload.neurologicalScreen, reflexes: { ...payload.neurologicalScreen.reflexes, [item]: e.target.value as ReflexResult } })}
                      >
                        <option value="not-tested">Not tested</option>
                        <option value="normal">Normal</option>
                        <option value="reduced">Reduced</option>
                        <option value="absent">Absent</option>
                        <option value="hyperreflexic">Hyperreflexic</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, marginTop: 10 }}>
              <input
                type="checkbox"
                checked={payload.neurologicalScreen.upperMotorNeuronSigns.present}
                disabled={readOnly}
                onChange={(e) => update('neurologicalScreen', { ...payload.neurologicalScreen, upperMotorNeuronSigns: { present: e.target.checked } })}
              />
              Upper motor neuron signs present
            </label>
          </div>
          )}
        </div>

        {region && SPINE_REGIONS.includes(region) && (
          <div className="initial-only">
            <p className="section-label" style={{ marginTop: 14 }}>ROM quick preset — {region}</p>
            <table className="mini-table">
              <thead><tr><th>Movement</th><th>Degrees</th><th>Pain</th></tr></thead>
              <tbody>
                {SPINE_ROM.map((movement) => {
                  const entry = payload.objective.rom.find((r) => r.movement === movement);
                  return (
                    <tr key={movement}>
                      <td>{movement}</td>
                      <td>
                        <input
                          type="number"
                          value={entry?.active ?? ''}
                          disabled={readOnly}
                          onChange={(e) => upsertRom(movement, { active: e.target.value ? Number(e.target.value) : null })}
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={entry?.painProvoked ?? false}
                          disabled={readOnly}
                          onChange={(e) => upsertRom(movement, { painProvoked: e.target.checked })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p className="section-label" style={{ margin: 0 }}>ROM</p>
            <div style={{ display: 'flex', gap: 6 }}>
              <MovementQuickPick region={region} disabled={readOnly} onPick={(m) => update('objective', { ...payload.objective, rom: [...payload.objective.rom, { movement: m, active: null, passive: null, unit: 'deg', painProvoked: false }] })} />
              <button className="btn-secondary" disabled={readOnly} onClick={() => update('objective', { ...payload.objective, rom: [...payload.objective.rom, { movement: '', active: null, passive: null, unit: 'deg', painProvoked: false }] })}>+ Add</button>
            </div>
          </div>
          {payload.objective.rom.map((r, i) => (
            <div key={i} className="field-row" style={{ marginBottom: 6, alignItems: 'center' }}>
              <input placeholder="Movement" value={r.movement} disabled={readOnly} onChange={(e) => update('objective', { ...payload.objective, rom: payload.objective.rom.map((x, j) => (j === i ? { ...x, movement: e.target.value } : x)) })} />
              <input type="number" placeholder="Active °" value={r.active ?? ''} disabled={readOnly} onChange={(e) => update('objective', { ...payload.objective, rom: payload.objective.rom.map((x, j) => (j === i ? { ...x, active: e.target.value ? Number(e.target.value) : null } : x)) })} />
              <input type="number" placeholder="Passive °" value={r.passive ?? ''} disabled={readOnly} onChange={(e) => update('objective', { ...payload.objective, rom: payload.objective.rom.map((x, j) => (j === i ? { ...x, passive: e.target.value ? Number(e.target.value) : null } : x)) })} />
              <button className="kebab" disabled={readOnly} onClick={() => update('objective', { ...payload.objective, rom: payload.objective.rom.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p className="section-label" style={{ margin: 0 }}>Strength / MMT</p>
            <div style={{ display: 'flex', gap: 6 }}>
              <MovementQuickPick region={region} disabled={readOnly} onPick={(m) => update('objective', { ...payload.objective, strength: [...payload.objective.strength, { movement: m, grade: 'not-tested' }] })} />
              <button className="btn-secondary" disabled={readOnly} onClick={() => update('objective', { ...payload.objective, strength: [...payload.objective.strength, { movement: '', grade: 'not-tested' }] })}>+ Add</button>
            </div>
          </div>
          {payload.objective.strength.map((s, i) => (
            <div key={i} className="field-row" style={{ marginBottom: 6, alignItems: 'center' }}>
              <input placeholder="Movement" value={s.movement} disabled={readOnly} onChange={(e) => update('objective', { ...payload.objective, strength: payload.objective.strength.map((x, j) => (j === i ? { ...x, movement: e.target.value } : x)) })} />
              <select value={s.grade} disabled={readOnly} onChange={(e) => update('objective', { ...payload.objective, strength: payload.objective.strength.map((x, j) => (j === i ? { ...x, grade: e.target.value as typeof x.grade } : x)) })}>
                {['5/5', '4/5', '3/5', '2/5', '1/5', '0/5', 'not-tested'].map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
              <select value={s.nerveRoot ?? ''} disabled={readOnly} onChange={(e) => update('objective', { ...payload.objective, strength: payload.objective.strength.map((x, j) => (j === i ? { ...x, nerveRoot: (e.target.value || undefined) as NeuroLevel | undefined } : x)) })}>
                <option value="">— root</option>
                {NEURO_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <button className="kebab" disabled={readOnly} onClick={() => update('objective', { ...payload.objective, strength: payload.objective.strength.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
        </div>

        <div className="initial-only">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p className="section-label" style={{ margin: 0 }}>Special tests</p>
            <button className="btn-secondary" disabled={readOnly} onClick={() => update('objective', { ...payload.objective, specialTests: [...payload.objective.specialTests, { testId: '', result: 'inconclusive' }] })}>+ Add</button>
          </div>
          {payload.objective.specialTests.map((t, i) => (
            <div key={i} className="field-row" style={{ marginBottom: 6, alignItems: 'center' }}>
              <input placeholder="Test (e.g. FABER)" value={t.testId} disabled={readOnly} onChange={(e) => update('objective', { ...payload.objective, specialTests: payload.objective.specialTests.map((x, j) => (j === i ? { ...x, testId: e.target.value } : x)) })} />
              <select value={t.result} disabled={readOnly} onChange={(e) => update('objective', { ...payload.objective, specialTests: payload.objective.specialTests.map((x, j) => (j === i ? { ...x, result: e.target.value as typeof x.result } : x)) })}>
                <option value="negative">Negative</option>
                <option value="positive">Positive</option>
                <option value="inconclusive">Inconclusive</option>
              </select>
              <button className="kebab" disabled={readOnly} onClick={() => update('objective', { ...payload.objective, specialTests: payload.objective.specialTests.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
        </div>
          </div>
        </div>

        {/* 7. Treatment */}
        <div
          ref={(el) => {
            if (el) sectionRefs.current.set('treatment', el);
            else sectionRefs.current.delete('treatment');
          }}
          className={`setup-section scroll-mt-20 ${openSections.has('treatment') ? 'open' : ''}`}
        >
          <button type="button" className="setup-section-head" onClick={() => toggleSection('treatment')}>
            <div><h3>Treatment / Intervention</h3><div className="sub">Today's session, load management</div></div>
            <span className="chev">›</span>
          </button>
          <div className="setup-section-body">
          <p className="section-label">Treatment / intervention</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <MultiToggle options={['Joint mobilisation', 'Manipulation', 'MFR', 'Taping', 'Dry needling']} value={payload.treatment.session.manualTherapy} onChange={(v) => update('treatment', { ...payload.treatment, session: { ...payload.treatment.session, manualTherapy: v } })} />
            <MultiToggle options={['Strengthening', 'Stretching', 'ROM', 'Neuromuscular', 'Balance', 'Plyometric']} value={payload.treatment.session.therapeuticExercise} onChange={(v) => update('treatment', { ...payload.treatment, session: { ...payload.treatment.session, therapeuticExercise: v } })} />
            <MultiToggle options={['Ultrasound', 'TENS', 'IFC', 'Heat/ice', 'Laser', 'Shockwave']} value={payload.treatment.session.modalities} onChange={(v) => update('treatment', { ...payload.treatment, session: { ...payload.treatment.session, modalities: v } })} />
            <div className="field-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <div className="field-block">
                <label>Session duration</label>
                <select value={payload.treatment.session.duration} disabled={readOnly} onChange={(e) => update('treatment', { ...payload.treatment, session: { ...payload.treatment.session, duration: e.target.value } })}>
                  <option value="">—</option>
                  {SESSION_DURATIONS.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="field-block">
                <label>Time spent (detail)</label>
                <input value={payload.treatment.session.timeSpent} disabled={readOnly} onChange={(e) => update('treatment', { ...payload.treatment, session: { ...payload.treatment.session, timeSpent: e.target.value } })} />
              </div>
              <div className="field-block">
                <label>Response</label>
                <select value={payload.treatment.session.response} disabled={readOnly} onChange={(e) => update('treatment', { ...payload.treatment, session: { ...payload.treatment.session, response: e.target.value as CoreAssessmentPayload['treatment']['session']['response'] } })}>
                  <option value="">—</option>
                  <option value="improved">Improved</option>
                  <option value="unchanged">Unchanged</option>
                  <option value="worse">Worse</option>
                  <option value="unclear">Unclear</option>
                </select>
              </div>
            </div>

            {(payload.chiefComplaint.onset === 'post-surgical' || payload.history.surgeries.some((s) => s.currentStatus === 'ongoing')) && (
              <>
                <p className="section-label" style={{ marginTop: 10 }}>Load management (post-surgical)</p>
                <div className="field-row">
                  <div className="field-block">
                    <label>Weight-bearing</label>
                    <select
                      value={payload.treatment.session.weightBearing ?? ''}
                      disabled={readOnly}
                      onChange={(e) => update('treatment', { ...payload.treatment, session: { ...payload.treatment.session, weightBearing: (e.target.value || undefined) as CoreAssessmentPayload['treatment']['session']['weightBearing'] } })}
                    >
                      <option value="">—</option>
                      <option value="nwb">NWB</option>
                      <option value="pwb">PWB</option>
                      <option value="wb">WBAT</option>
                      <option value="fwb">FWB</option>
                    </select>
                  </div>
                  {payload.treatment.session.weightBearing === 'pwb' && (
                    <div className="field-block">
                      <label>PWB %</label>
                      <input
                        type="number"
                        value={payload.treatment.session.pwbPercentage ?? ''}
                        disabled={readOnly}
                        onChange={(e) => update('treatment', { ...payload.treatment, session: { ...payload.treatment.session, pwbPercentage: e.target.value ? Number(e.target.value) : undefined } })}
                      />
                    </div>
                  )}
                </div>
                <div className="field-row">
                  <div className="field-block">
                    <label>Brace</label>
                    <select
                      value={payload.treatment.session.brace ?? ''}
                      disabled={readOnly}
                      onChange={(e) => update('treatment', { ...payload.treatment, session: { ...payload.treatment.session, brace: (e.target.value || undefined) as CoreAssessmentPayload['treatment']['session']['brace'] } })}
                    >
                      <option value="">—</option>
                      <option value="none">None</option>
                      <option value="hinged">Hinged</option>
                      <option value="locked">Locked</option>
                    </select>
                  </div>
                  {payload.treatment.session.brace === 'locked' && (
                    <div className="field-block">
                      <label>Locked at (°)</label>
                      <input
                        value={payload.treatment.session.lockedDegrees ?? ''}
                        disabled={readOnly}
                        onChange={(e) => update('treatment', { ...payload.treatment, session: { ...payload.treatment.session, lockedDegrees: e.target.value || undefined } })}
                      />
                    </div>
                  )}
                  <div className="field-block">
                    <label>ROM limit (°)</label>
                    <input
                      type="number"
                      value={payload.treatment.session.romLimit ?? ''}
                      disabled={readOnly}
                      onChange={(e) => update('treatment', { ...payload.treatment, session: { ...payload.treatment.session, romLimit: e.target.value ? Number(e.target.value) : undefined } })}
                    />
                  </div>
                </div>
              </>
            )}

            <div className="field-block" style={{ margin: 0 }}>
              <label>Notes</label>
              <textarea value={payload.treatment.notes} disabled={readOnly} onChange={(e) => update('treatment', { ...payload.treatment, notes: e.target.value })} />
            </div>
          </div>
          </div>
        </div>

        {/* 8. HEP — manual entry, no library browser yet */}
        <div
          ref={(el) => {
            if (el) sectionRefs.current.set('hep', el);
            else sectionRefs.current.delete('hep');
          }}
          className={`setup-section scroll-mt-20 ${openSections.has('hep') ? 'open' : ''}`}
        >
          <button type="button" className="setup-section-head" onClick={() => toggleSection('hep')}>
            <div><h3>Home Exercise Program</h3><div className="sub">{payload.hep.exercises.length} exercise{payload.hep.exercises.length === 1 ? '' : 's'} prescribed</div></div>
            <span className="chev">›</span>
          </button>
          <div className="setup-section-body">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p className="section-label" style={{ margin: 0 }}>Home exercise program</p>
            <button className="btn-secondary" disabled={readOnly} onClick={() => update('hep', { ...payload.hep, exercises: [...payload.hep.exercises, { name: '', sets: 3, reps: 10, unit: 'reps', frequency: 'Daily' }] })}>+ Add exercise</button>
          </div>
          <p className="empty-note" style={{ marginTop: 0 }}>Manual entry only — the exercise library browser isn't built yet.</p>
          {payload.hep.exercises.map((ex, i) => (
            <div key={i} className="field-row" style={{ marginBottom: 10, alignItems: 'end', gridTemplateColumns: 'repeat(4, 1fr) auto' }}>
              <div className="field-block" style={{ margin: 0 }}>
                <label>Exercise name</label>
                <input placeholder="e.g. Wall slides" value={ex.name} disabled={readOnly} onChange={(e) => update('hep', { ...payload.hep, exercises: payload.hep.exercises.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              </div>
              <div className="field-block" style={{ margin: 0 }}>
                <label>Sets</label>
                <input type="number" value={ex.sets} disabled={readOnly} onChange={(e) => update('hep', { ...payload.hep, exercises: payload.hep.exercises.map((x, j) => (j === i ? { ...x, sets: Number(e.target.value) } : x)) })} />
              </div>
              <div className="field-block" style={{ margin: 0 }}>
                <label>Reps</label>
                <input type="number" value={ex.reps} disabled={readOnly} onChange={(e) => update('hep', { ...payload.hep, exercises: payload.hep.exercises.map((x, j) => (j === i ? { ...x, reps: Number(e.target.value) } : x)) })} />
              </div>
              <div className="field-block" style={{ margin: 0 }}>
                <label>Frequency / hold</label>
                <input placeholder="e.g. Daily, hold 30s" value={ex.frequency} disabled={readOnly} onChange={(e) => update('hep', { ...payload.hep, exercises: payload.hep.exercises.map((x, j) => (j === i ? { ...x, frequency: e.target.value } : x)) })} />
              </div>
              <button className="kebab" disabled={readOnly} onClick={() => update('hep', { ...payload.hep, exercises: payload.hep.exercises.filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <div className="field-block">
            <label>Compliance</label>
            <select value={payload.hep.compliance} disabled={readOnly} onChange={(e) => update('hep', { ...payload.hep, compliance: e.target.value as CoreAssessmentPayload['hep']['compliance'] })}>
              <option value="">—</option>
              <option value="doing-all">Doing all</option>
              <option value="most-days">Most days</option>
              <option value="some-days">Some days</option>
              <option value="rarely">Rarely</option>
              <option value="not-started">Not started</option>
            </select>
          </div>
          </div>
        </div>

        {/* 9. Plan & Goals */}
        <div
          ref={(el) => {
            if (el) sectionRefs.current.set('plan', el);
            else sectionRefs.current.delete('plan');
          }}
          className={`setup-section scroll-mt-20 ${openSections.has('plan') ? 'open' : ''}`}
        >
          <button type="button" className="setup-section-head" onClick={() => toggleSection('plan')}>
            <div><h3>Plan &amp; Goals</h3><div className="sub">{payload.plan.goals.length} goal{payload.plan.goals.length === 1 ? '' : 's'}</div></div>
            <span className="chev">›</span>
          </button>
          <div className="setup-section-body">
          <p className="section-label">Plan &amp; goals</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="field-row">
              <div className="field-block">
                <label>Phase</label>
                <select value={payload.plan.phase} disabled={readOnly} onChange={(e) => update('plan', { ...payload.plan, phase: e.target.value as CoreAssessmentPayload['plan']['phase'] })}>
                  <option value="">—</option>
                  <option value="acute">Acute</option>
                  <option value="subacute">Subacute</option>
                  <option value="chronic">Chronic</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="rts-prep">RTS-prep</option>
                  <option value="discharge">Discharge</option>
                </select>
              </div>
              <div className="field-block">
                <label>Estimated sessions</label>
                <select value={payload.plan.estimatedSessions} disabled={readOnly} onChange={(e) => update('plan', { ...payload.plan, estimatedSessions: e.target.value })}>
                  <option value="">—</option>
                  <option value="4-6">4–6</option>
                  <option value="6-10">6–10</option>
                  <option value="10-15">10–15</option>
                  <option value="15+">15+</option>
                  <option value="Uncertain">Uncertain</option>
                </select>
              </div>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)' }}>Goals</label>
                <button className="btn-secondary" disabled={readOnly} onClick={() => update('plan', { ...payload.plan, goals: [...payload.plan.goals, { text: '', targetTerm: '' }] })}>+ Add</button>
              </div>
              {payload.plan.goals.map((g, i) => (
                <div key={i} className="field-row" style={{ marginTop: 6, alignItems: 'center', gridTemplateColumns: '1fr 120px 140px auto' }}>
                  <input placeholder="Goal" value={g.text} disabled={readOnly} onChange={(e) => update('plan', { ...payload.plan, goals: payload.plan.goals.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                  <select value={g.targetTerm} disabled={readOnly} onChange={(e) => update('plan', { ...payload.plan, goals: payload.plan.goals.map((x, j) => (j === i ? { ...x, targetTerm: e.target.value as 'short-term' | 'long-term' | '' } : x)) })}>
                    <option value="">Term…</option>
                    <option value="short-term">Short-term</option>
                    <option value="long-term">Long-term</option>
                  </select>
                  <input type="date" value={g.targetDate ?? ''} disabled={readOnly} onChange={(e) => update('plan', { ...payload.plan, goals: payload.plan.goals.map((x, j) => (j === i ? { ...x, targetDate: e.target.value } : x)) })} />
                  <button className="kebab" disabled={readOnly} onClick={() => update('plan', { ...payload.plan, goals: payload.plan.goals.filter((_, j) => j !== i) })}>✕</button>
                </div>
              ))}
            </div>
            <div className="field-block" style={{ margin: 0 }}>
              <label>Patient education</label>
              <MultiToggle options={['Posture', 'HEP', 'Pain neuroscience', 'Ergonomics', 'Activity modification', 'Load progression']} value={payload.plan.patientEducation} onChange={(v) => update('plan', { ...payload.plan, patientEducation: v })} />
            </div>
          </div>
          </div>
        </div>

        {/* 10. Outcome tracking */}
        {outcomeCards.length > 0 && (
          <div
            ref={(el) => {
              if (el) sectionRefs.current.set('outcome', el);
              else sectionRefs.current.delete('outcome');
            }}
            className={`setup-section scroll-mt-20 ${openSections.has('outcome') ? 'open' : ''}`}
          >
            <button type="button" className="setup-section-head" onClick={() => toggleSection('outcome')}>
              <div><h3>Outcome Tracking</h3><div className="sub">PSFS &amp; NRS trend</div></div>
              <span className="chev">›</span>
            </button>
            <div className="setup-section-body">
            <div className="stat-row" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
              {outcomeCards.map((card) => {
                const trend = card.previous !== null ? outcomeTrend(card.direction, card.previous, card.latest) : null;
                // The arrow is the raw direction of the number (▲ = went
                // up, ▼ = went down) — independent of the trend label,
                // which reads that change through this instrument's
                // polarity. NRS improving is a decrease, so it's "▼
                // Improving," never "▲ Improving."
                const arrow =
                  card.previous === null || card.latest === card.previous
                    ? null
                    : card.latest > card.previous
                      ? '▲'
                      : '▼';
                return (
                  <div className={`outcome-card${trend ? ` ${trend}` : ''}`} key={card.instrument}>
                    <div className="instrument">{card.instrument}</div>
                    <div className="score">
                      {card.previous !== null ? `${card.previous}→${card.latest}` : card.latest}
                      {arrow && <span className="arrow">{arrow}</span>}
                    </div>
                    {trend && (
                      <div className="trend-label">
                        {trend === 'improving' ? 'Improving' : trend === 'declining' ? 'Declining' : 'Stable'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 6 }}>
              Direction is per-instrument (higher-is-better for PSFS, lower-is-better for NRS) — never read off the
              raw sign of the change.
            </p>
            </div>
          </div>
        )}

          </div>
        </div>

        <div>
          <p className="section-label">Free notes</p>
          <textarea
            className="setup-card"
            style={{ width: '100%', minHeight: 80, boxSizing: 'border-box' }}
            value={payload.freeNotes}
            disabled={readOnly}
            onChange={(e) => update('freeNotes', e.target.value)}
          />
        </div>

        {!readOnly && (
          <div className="modal-actions" style={{ justifyContent: 'flex-start', marginBottom: 24 }}>
            <button className="btn-secondary" onClick={() => save('draft')} disabled={busy}>
              {busy ? 'Saving…' : 'Save draft'}
            </button>
            <button className="btn-primary" onClick={() => save('completed')} disabled={busy}>
              {busy ? 'Saving…' : 'Mark completed'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
