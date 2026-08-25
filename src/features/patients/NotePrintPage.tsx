import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatDateDMY } from '@/domain/fiscalYear';
import { publicLogoUrl } from '@/lib/supabase';
import { btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { upcastPayload, outcomeInstrumentDef, frequencyLabel, outcomeTrend, RED_FLAG_ITEMS, YELLOW_FLAG_ITEMS, type CoreAssessmentPayload } from '@/domain/coreAssessment';

/** One label/value row; omitted entirely when value is empty — printed
 *  documents shouldn't carry blank placeholders for fields nobody filled. */
function Row({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <p className="text-sm">
      <span className="text-[var(--muted)]">{label}: </span>
      <span className="text-[var(--ink)]">{value}</span>
    </p>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 break-inside-avoid">
      <h2 className="border-b border-[var(--border)] pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
        {title}
      </h2>
      <div className="mt-2 space-y-1">{children}</div>
    </section>
  );
}

export function NotePrintPage() {
  const clinic = useClinic();
  const { noteId } = useParams({ strict: false }) as { noteId: string };
  const note = useLiveQuery(() => repos.consultationNotes.get(noteId), [noteId]);
  const patient = useLiveQuery(() => (note ? repos.patients.get(note.patientId) : undefined), [note?.patientId]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const [paper, setPaper] = useState<'A4' | 'A5'>('A4');

  const logoUrl = useMemo(() => publicLogoUrl(clinic.logoPath), [clinic.logoPath]);
  const signatureUrl = useMemo(() => publicLogoUrl(clinic.signaturePath), [clinic.signaturePath]);

  useEffect(() => {
    if (!note || !patient) return;
    const previousTitle = document.title;
    document.title = `${patient.name} - ${patient.mrno}`;
    return () => {
      document.title = previousTitle;
    };
  }, [note, patient]);

  if (!note || patient === undefined) {
    return <div className="p-8 text-sm text-[var(--muted)]">Note not found (or not yet synced).</div>;
  }

  const therapist = therapists?.find((t) => t.id === note.therapistId);
  const payload: CoreAssessmentPayload | null = note.assessmentPayload ? upcastPayload(note.assessmentPayload) : null;
  const cc = payload?.chiefComplaint;
  const h = payload?.history;
  const redFlagsPresent = payload ? RED_FLAG_ITEMS.filter((f) => payload.screening.redFlags[f] === 'yes') : [];
  const yellowFlagsPresent = payload
    ? YELLOW_FLAG_ITEMS.filter((f) => payload.screening.yellowFlags[f] === 'some-concern' || payload.screening.yellowFlags[f] === 'significant-concern')
    : [];

  return (
    <div className="min-h-screen bg-[var(--paper)] print:bg-[var(--surface)]">
      <style>{`@page { size: ${paper}; margin: ${paper === 'A5' ? '10mm' : '16mm'}; }`}</style>

      <div className="no-print mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
        <Link to="/patients/$patientId" params={{ patientId: patient.id }} className={btnSecondary}>
          ← Back
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <select className={inputCls} value={paper} onChange={(e) => setPaper(e.target.value as 'A4' | 'A5')}>
            <option value="A4">A4</option>
            <option value="A5">A5</option>
          </select>
          <button type="button" className={btnPrimary} onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl bg-[var(--surface)] p-8 print:max-w-none print:p-0">
        {/* Letterhead */}
        <header className="flex items-start justify-between border-b border-[var(--border)] pb-4">
          <div className="flex items-center gap-3">
            {logoUrl && <img src={logoUrl} alt="" className="h-14 w-auto object-contain" />}
            <div>
              <h1 className="font-display text-xl font-bold text-[var(--ink)]">{clinic.name}</h1>
              {clinic.address && <p className="text-xs text-[var(--muted)]">{clinic.address}</p>}
              <p className="text-xs text-[var(--muted)]">{[clinic.phone, clinic.email].filter(Boolean).join(' · ')}</p>
            </div>
          </div>
        </header>

        {/* Note meta + patient */}
        <section className="mt-4 flex justify-between text-sm">
          <div>
            <p className="font-display font-semibold text-[var(--ink)]">{patient.name}</p>
            <p className="text-[var(--muted)]">Patient ID: {patient.mrno}</p>
            {(patient.age != null || patient.sex) && (
              <p className="text-[var(--muted)]">
                {[patient.age != null ? `${patient.age}y` : null, patient.sex].filter(Boolean).join(' / ')}
              </p>
            )}
          </div>
          <div className="text-right">
            <p className="text-lg font-bold text-[var(--ink)]">CLINICAL NOTE</p>
            <p className="text-[var(--muted)]">{formatDateDMY(note.updatedAt)}</p>
            {note.noteMode && (
              <p className="text-[var(--muted)]">{note.noteMode === 'initial' ? 'Initial Evaluation' : 'Follow-up'}</p>
            )}
            <p
              className="mt-1 inline-block rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold"
              style={
                note.status === 'completed'
                  ? { background: 'var(--moss-light)', color: 'var(--moss-strong)' }
                  : { background: 'var(--amber-light)', color: 'var(--amber)' }
              }
            >
              {note.status === 'completed' ? 'COMPLETED' : note.status.toUpperCase()}
            </p>
          </div>
        </section>

        {payload?.referral && (payload.referral.referringPhysician || payload.referral.diagnosis) && (
          <Section title="Referral & Diagnosis">
            <Row label="Referring physician" value={payload.referral.referringPhysician} />
            <Row label="Physician reg. no." value={payload.referral.physicianRegistrationNo} />
            <Row label="Referral date" value={payload.referral.referralDate ? formatDateDMY(payload.referral.referralDate) : null} />
            <Row label="Diagnosis" value={payload.referral.diagnosis} />
            <Row label="ICD-10 code" value={payload.referral.diagnosisIcdCode} />
          </Section>
        )}

        {!payload && note.notesText && (
          <Section title="Note">
            <p className="whitespace-pre-wrap text-sm text-[var(--ink)]">{note.notesText}</p>
          </Section>
        )}

        {payload && cc && h && (
          <>
            <Section title="Chief Complaint">
              <Row label="Region" value={cc.anatomicalRegion || null} />
              <Row label="Presenting problem" value={cc.presentingProblem} />
              <Row label="Primary complaint" value={cc.primaryComplaint.join(', ')} />
              <Row
                label="Onset"
                value={
                  cc.onset === 'post-surgical' && cc.postSurgical
                    ? `Post-surgical — ${cc.postSurgical.surgeryType || 'surgery'}${cc.postSurgical.surgeryDate ? ` on ${formatDateDMY(cc.postSurgical.surgeryDate)}` : ''}${cc.postSurgical.postOpWeek != null ? ` (post-op week ${cc.postSurgical.postOpWeek})` : ''}`
                    : cc.onset || null
                }
              />
              <Row label="Occupation" value={cc.occupation} />
              <Row label="Activity" value={cc.activity} />
              <Row label="Trend" value={cc.trend || null} />
            </Section>

            <Section title="History">
              <Row label="Medical conditions" value={h.medicalConditions.join(', ')} />
              <Row label="Medications" value={h.medications} />
              <Row label="Allergies" value={h.allergies} />
              <Row label="On blood thinner" value={h.anticoagulant.onBloodThinner ? (h.anticoagulant.details || 'Yes') : null} />
              <Row label="Implants" value={h.implants.present ? `${h.implants.type ?? 'Present'}${h.implants.details ? ` — ${h.implants.details}` : ''}` : null} />
              {h.surgeries.length > 0 && (
                <Row label="Prior surgeries" value={h.surgeries.map((s) => `${s.procedure} (${s.date || 'date unknown'})`).join('; ')} />
              )}
            </Section>

            {(redFlagsPresent.length > 0 || yellowFlagsPresent.length > 0) && (
              <Section title="Screening">
                {redFlagsPresent.length > 0 && (
                  <p className="text-sm">
                    <span className="font-semibold text-[var(--rust)]">Red flags: </span>
                    <span className="text-[var(--ink)]">{redFlagsPresent.join(', ')}</span>
                  </p>
                )}
                {yellowFlagsPresent.length > 0 && (
                  <p className="text-sm">
                    <span className="font-semibold text-[var(--amber)]">Yellow flags: </span>
                    <span className="text-[var(--ink)]">{yellowFlagsPresent.join(', ')}</span>
                  </p>
                )}
              </Section>
            )}

            {(payload.painProfile.nrs.current != null || payload.painProfile.pattern) && (
              <Section title="Pain Profile">
                <Row
                  label="NRS"
                  value={
                    payload.painProfile.nrs.current != null
                      ? `${payload.painProfile.nrs.current}/10${payload.painProfile.nrs.best != null ? ` (best ${payload.painProfile.nrs.best}` : ''}${payload.painProfile.nrs.worst != null ? `${payload.painProfile.nrs.best != null ? ', ' : ' ('}worst ${payload.painProfile.nrs.worst})` : payload.painProfile.nrs.best != null ? ')' : ''}`
                      : null
                  }
                />
                <Row label="Pattern" value={payload.painProfile.pattern || null} />
                <Row label="Aggravating" value={payload.painProfile.aggravating} />
                <Row label="Easing" value={payload.painProfile.easing} />
              </Section>
            )}

            {payload.functionalStatus.activities.length > 0 && (
              <Section title="Functional Status (PSFS)">
                {payload.functionalStatus.activities.map((a, i) => (
                  <Row key={i} label={a.label} value={`${a.baseline} → ${a.current} / 10`} />
                ))}
              </Section>
            )}

            {(payload.objective.rom.length > 0 || payload.objective.strength.length > 0 || payload.objective.specialTests.length > 0) && (
              <Section title="Objective">
                {payload.objective.rom.map((r, i) => (
                  <Row key={`rom-${i}`} label={`ROM — ${r.movement}${r.side ? ` (${r.side})` : ''}`} value={`Active ${r.active ?? '—'}${r.unit}, Passive ${r.passive ?? '—'}${r.unit}`} />
                ))}
                {payload.objective.strength.map((s, i) => (
                  <Row key={`str-${i}`} label={`Strength — ${s.movement}${s.side ? ` (${s.side})` : ''}`} value={s.grade} />
                ))}
                {payload.objective.specialTests.map((t, i) => (
                  <Row key={`test-${i}`} label={t.testId} value={t.result} />
                ))}
              </Section>
            )}

            <Section title="Treatment">
              <Row label="Manual therapy" value={payload.treatment.session.manualTherapy.join(', ')} />
              <Row label="Therapeutic exercise" value={payload.treatment.session.therapeuticExercise.join(', ')} />
              <Row label="Modalities" value={payload.treatment.session.modalities.join(', ')} />
              <Row label="Duration" value={payload.treatment.session.duration || payload.treatment.session.timeSpent} />
              <Row label="Response" value={payload.treatment.session.response || null} />
              <Row
                label="Weight-bearing"
                value={
                  payload.treatment.session.weightBearing
                    ? `${payload.treatment.session.weightBearing.toUpperCase()}${payload.treatment.session.pwbPercentage != null ? ` (${payload.treatment.session.pwbPercentage}%)` : ''}`
                    : null
                }
              />
              <Row label="Brace" value={payload.treatment.session.brace && payload.treatment.session.brace !== 'none' ? `${payload.treatment.session.brace}${payload.treatment.session.lockedDegrees ? ` at ${payload.treatment.session.lockedDegrees}` : ''}` : null} />
              <Row label="Wound status" value={payload.treatment.session.woundStatus ?? null} />
              <Row label="Suture status" value={payload.treatment.session.sutureStatus && payload.treatment.session.sutureStatus !== 'na' ? payload.treatment.session.sutureStatus : null} />
              <Row label="Notes" value={payload.treatment.notes} />
            </Section>

            {payload.hep.exercises.length > 0 && (
              <Section title="Home Exercise Program">
                {payload.hep.exercises.map((ex, i) => (
                  <Row key={i} label={ex.name} value={`${ex.sets} × ${ex.reps} ${ex.unit}, ${ex.frequency}`} />
                ))}
                <Row label="Compliance" value={payload.hep.compliance || null} />
              </Section>
            )}

            <Section title="Plan">
              <Row label="Phase" value={payload.plan.phase || null} />
              <Row label="Frequency" value={frequencyLabel(payload.plan.frequencyPerWeek, payload.plan.durationWeeks)} />
              <Row label="Estimated sessions" value={payload.plan.estimatedSessions} />
              {payload.plan.goals.length > 0 && (
                <Row label="Goals" value={payload.plan.goals.map((g) => g.text).filter(Boolean).join('; ')} />
              )}
              <Row label="Patient education" value={payload.plan.patientEducation.join(', ')} />
            </Section>

            {payload.outcomeTracking && payload.outcomeTracking.instruments.length > 0 && (
              <Section title="Outcome Tracking">
                {payload.outcomeTracking.instruments.map((entry, i) => {
                  const def = outcomeInstrumentDef(entry.instrumentId);
                  const trend =
                    entry.previousScore != null ? outcomeTrend(entry.direction, entry.previousScore, entry.latestScore) : entry.trend;
                  return (
                    <Row
                      key={i}
                      label={def?.label ?? entry.instrumentId}
                      value={`${entry.previousScore != null ? `${entry.previousScore} → ` : ''}${entry.latestScore}${trend ? ` (${trend})` : ''}`}
                    />
                  );
                })}
              </Section>
            )}

            {payload.freeNotes && (
              <Section title="Additional Notes">
                <p className="whitespace-pre-wrap text-sm text-[var(--ink)]">{payload.freeNotes}</p>
              </Section>
            )}
          </>
        )}

        {/* Footer */}
        <footer className="mt-12 flex items-end justify-between border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
          <div>
            <p>Issued {formatDateDMY(note.updatedAt)}</p>
            {therapist && (
              <p>
                Therapist: {therapist.name}
                {therapist.registrationNo && ` · Reg. No. ${therapist.registrationNo}`}
              </p>
            )}
          </div>
          <div className="text-center">
            {signatureUrl ? (
              <img src={signatureUrl} alt="" className="mb-1 h-10 w-40 object-contain object-bottom" />
            ) : (
              <div className="mb-1 h-10 w-40 border-b border-[var(--border)]" />
            )}
            <p>Authorised signature</p>
          </div>
        </footer>
      </div>
    </div>
  );
}
