import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { getSupabase } from '@/lib/supabase';
import { ScaleWidget } from '@/components/ScaleWidget';
import { repos, consultationNoteService } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import {
  RED_FLAG_ITEMS,
  YELLOW_FLAG_ITEMS,
  NEURO_LEVELS,
  REFLEX_ITEMS,
  WORK_DEMAND_LEVELS,
  PSFS_MCID_THRESHOLD,
  emptyPayload,
  upcastPayload,
  computeDerivedFields,
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
} from '@/domain/coreAssessment';

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
  const { patientId, noteId } = useParams({ strict: false }) as {
    patientId: string;
    noteId?: string;
  };

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
  const [authorizedSessionCount, setAuthorizedSessionCount] = useState('');
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
  // carry-forward collapse above.
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['chiefComplaint', 'subjective']));
  function toggleSection(key: string) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const [screeningOpen, setScreeningOpen] = useState(false);

  useEffect(() => {
    if (therapists && therapists.length > 0 && !therapistId) setTherapistId(therapists[0].id);
  }, [therapists, therapistId]);

  useEffect(() => {
    let cancelled = false;
    async function init() {
      if (existingNote) {
        setEnrollmentId(existingNote.enrollmentId);
        const mode = existingNote.noteMode ?? 'initial';
        setNoteMode(mode);
        setStatus(existingNote.status === 'completed' ? 'completed' : 'draft');
        setTherapistId(existingNote.therapistId);
        setAuthorizedSessionCount(existingNote.authorizedSessionCount?.toString() ?? '');
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
      if (mode === 'followup') setExpanded(new Set());
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
    setBusy(true);
    setError(null);
    try {
      await consultationNoteService.saveAssessment(
        {
          id: existingNote?.id,
          clinicId: clinic.id,
          patientId,
          therapistId,
          visitId: existingNote?.visitId ?? null,
          enrollmentId,
          noteMode,
          authorizedSessionCount: authorizedSessionCount ? Number(authorizedSessionCount) : null,
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

  if (!ready || patient === undefined) return null;

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

        <div className="field-row">
          <div className="field-block">
            <label>Therapist</label>
            <select value={therapistId} onChange={(e) => setTherapistId(e.target.value)} disabled={readOnly}>
              {(therapists ?? []).map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div className="field-block">
            <label>Authorized sessions</label>
            <input
              type="number"
              min={1}
              value={authorizedSessionCount}
              onChange={(e) => setAuthorizedSessionCount(e.target.value)}
              disabled={readOnly}
            />
          </div>
        </div>

        <div className="setup-accordion">

        {/* 1. Chief Complaint */}
        <div className={`setup-section ${openSections.has('chiefComplaint') ? 'open' : ''}`}>
          <button type="button" className="setup-section-head" onClick={() => toggleSection('chiefComplaint')}>
            <div><h3>Chief Complaint</h3><div className="sub">Onset, activity context, post-surgical detail</div></div>
            <span className="chev">›</span>
          </button>
          <div className="setup-section-body">
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
              <div className="field-row">
                <div className="field-block">
                  <label>Work demand level</label>
                  <select
                    value={payload.chiefComplaint.workDemandLevel}
                    disabled={readOnly}
                    onChange={(e) => update('chiefComplaint', { ...payload.chiefComplaint, workDemandLevel: e.target.value as CoreAssessmentPayload['chiefComplaint']['workDemandLevel'] })}
                  >
                    <option value="">—</option>
                    {WORK_DEMAND_LEVELS.map((w) => (
                      <option key={w.value} value={w.value}>{w.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field-block">
                  <label>Job/role</label>
                  <input
                    value={payload.chiefComplaint.jobRole ?? ''}
                    disabled={readOnly}
                    onChange={(e) => update('chiefComplaint', { ...payload.chiefComplaint, jobRole: e.target.value })}
                  />
                </div>
              </div>
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
            </div>
          )}
          </div>
        </div>

        {/* 2. History */}
        <div className={`setup-section ${openSections.has('history') ? 'open' : ''}`}>
          <button type="button" className="setup-section-head" onClick={() => toggleSection('history')}>
            <div><h3>Medical, Trauma &amp; Surgical History</h3><div className="sub">Conditions, safety flags, past trauma/surgery</div></div>
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
                  <div key={i} className="field-row" style={{ marginTop: 6, alignItems: 'center' }}>
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
                  <div key={i} className="field-row" style={{ marginTop: 6, alignItems: 'center' }}>
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
            </div>
          )}
          </div>
        </div>

        {/* 4. Subjective — Pain Profile (body chart deferred, no reference artwork yet) */}
        <div className={`setup-section ${openSections.has('subjective') ? 'open' : ''}`}>
          <button type="button" className="setup-section-head" onClick={() => toggleSection('subjective')}>
            <div><h3>Subjective</h3><div className="sub">Body chart, pain profile</div></div>
            <span className="chev">›</span>
          </button>
          <div className="setup-section-body">
          <p className="section-label">Pain profile</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 10.5, fontWeight: 600, textTransform: 'uppercase', color: 'var(--muted)' }}>NRS (0–10)</label>
              <ScaleWidget
                variant="nrs"
                value={payload.painProfile.nrs}
                onChange={(n) => update('painProfile', { ...payload.painProfile, nrs: n })}
                endpoints={['No pain', 'Worst imaginable']}
                disabled={readOnly}
              />
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

          {/* Body chart — reserved shape, real interaction deferred */}
          <p className="section-label" style={{ marginTop: 14 }}>Body chart</p>
          <p className="empty-note">
            {payload.bodyChart.marks.length} mark{payload.bodyChart.marks.length === 1 ? '' : 's'} recorded — tap-to-mark UI not built yet (needs the reference artwork integration).
          </p>
          </div>
        </div>

        {/* 5. Functional Status (PSFS) */}
        <div className={`setup-section ${openSections.has('psfs') ? 'open' : ''}`}>
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
        <div className={`setup-section ${openSections.has('objective') ? 'open' : ''}`}>
          <button type="button" className="setup-section-head" onClick={() => toggleSection('objective')}>
            <div>
              <h3>Objective</h3>
              <div className="sub">{noteMode === 'followup' ? 'Tracked measures only' : 'Full battery — gait, palpation, neuro, ROM, MMT, special tests'}</div>
            </div>
            <span className="chev">›</span>
          </button>
          <div className="setup-section-body">
          <div className="initial-only">
          <p className="section-label">Gait &amp; posture</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <MultiToggle options={['Normal', 'Limping/Antalgic', 'Trendelenburg', 'Ataxic', 'Stooped']} value={payload.gaitPosture.gait} onChange={(v) => update('gaitPosture', { ...payload.gaitPosture, gait: v })} />
            <MultiToggle options={['Normal', 'Forward head', 'Rounded shoulders', 'Increased kyphosis', 'Increased lordosis', 'Scoliosis']} value={payload.gaitPosture.posture} onChange={(v) => update('gaitPosture', { ...payload.gaitPosture, posture: v })} />
            <div className="field-block" style={{ margin: 0 }}>
              <label>Assistive device</label>
              <input value={payload.gaitPosture.assistiveDevice} disabled={readOnly} onChange={(e) => update('gaitPosture', { ...payload.gaitPosture, assistiveDevice: e.target.value })} />
            </div>
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
          <p className="section-label">Neurological screen</p>
          <div style={{ overflowX: 'auto' }}>
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
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <p className="section-label" style={{ margin: 0 }}>ROM</p>
            <button className="btn-secondary" disabled={readOnly} onClick={() => update('objective', { ...payload.objective, rom: [...payload.objective.rom, { movement: '', active: null, passive: null, unit: 'deg', painProvoked: false }] })}>+ Add</button>
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
            <button className="btn-secondary" disabled={readOnly} onClick={() => update('objective', { ...payload.objective, strength: [...payload.objective.strength, { movement: '', grade: 'not-tested' }] })}>+ Add</button>
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
        <div className={`setup-section ${openSections.has('treatment') ? 'open' : ''}`}>
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
            <div className="field-row">
              <div className="field-block">
                <label>Time spent</label>
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
            <div className="field-block" style={{ margin: 0 }}>
              <label>Notes</label>
              <textarea value={payload.treatment.notes} disabled={readOnly} onChange={(e) => update('treatment', { ...payload.treatment, notes: e.target.value })} />
            </div>
          </div>
          </div>
        </div>

        {/* 8. HEP — manual entry, no library browser yet */}
        <div className={`setup-section ${openSections.has('hep') ? 'open' : ''}`}>
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
            <div key={i} className="field-row" style={{ marginBottom: 6, alignItems: 'center' }}>
              <input placeholder="Exercise" value={ex.name} disabled={readOnly} onChange={(e) => update('hep', { ...payload.hep, exercises: payload.hep.exercises.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
              <input type="number" placeholder="Sets" value={ex.sets} disabled={readOnly} onChange={(e) => update('hep', { ...payload.hep, exercises: payload.hep.exercises.map((x, j) => (j === i ? { ...x, sets: Number(e.target.value) } : x)) })} />
              <input type="number" placeholder="Reps" value={ex.reps} disabled={readOnly} onChange={(e) => update('hep', { ...payload.hep, exercises: payload.hep.exercises.map((x, j) => (j === i ? { ...x, reps: Number(e.target.value) } : x)) })} />
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
        <div className={`setup-section ${openSections.has('plan') ? 'open' : ''}`}>
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
                <button className="btn-secondary" disabled={readOnly} onClick={() => update('plan', { ...payload.plan, goals: [...payload.plan.goals, { text: '' }] })}>+ Add</button>
              </div>
              {payload.plan.goals.map((g, i) => (
                <div key={i} className="field-row" style={{ marginTop: 6, alignItems: 'center' }}>
                  <input placeholder="Goal" value={g.text} disabled={readOnly} onChange={(e) => update('plan', { ...payload.plan, goals: payload.plan.goals.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
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

        {/* 10. General Health */}
        <div className={`setup-section ${openSections.has('generalHealth') ? 'open' : ''}`}>
          <button type="button" className="setup-section-head" onClick={() => toggleSection('generalHealth')}>
            <div><h3>General Health</h3><div className="sub">Vitals, falls risk</div></div>
            <span className="chev">›</span>
          </button>
          <div className="setup-section-body">
          {isCollapsed('generalHealth') ? (
            <CarryForward
              summary={`Weight ${payload.generalHealth?.weightKg ?? '—'}kg · Height ${payload.generalHealth?.heightCm ?? '—'}cm`}
              onUpdate={() => expand('generalHealth')}
            />
          ) : (
            <div className="initial-only field-row">
              <div className="field-block">
                <label>Weight (kg)</label>
                <input type="number" value={payload.generalHealth?.weightKg ?? ''} disabled={readOnly} onChange={(e) => update('generalHealth', { ...payload.generalHealth, weightKg: e.target.value ? Number(e.target.value) : undefined, vitals: payload.generalHealth?.vitals ?? [] })} />
              </div>
              <div className="field-block">
                <label>Height (cm)</label>
                <input type="number" value={payload.generalHealth?.heightCm ?? ''} disabled={readOnly} onChange={(e) => update('generalHealth', { ...payload.generalHealth, heightCm: e.target.value ? Number(e.target.value) : undefined, vitals: payload.generalHealth?.vitals ?? [] })} />
              </div>
            </div>
          )}
          </div>
        </div>

        {/* 11. Outcome tracking */}
        {outcomeCards.length > 0 && (
          <div className={`setup-section ${openSections.has('outcome') ? 'open' : ''}`}>
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
