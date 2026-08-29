import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import type { PatientProfileBackTarget } from '@/app/router';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { formatDateDMY } from '@/domain/fiscalYear';
import { publicLogoUrl } from '@/lib/supabase';
import { btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import {
  upcastSessionPayload,
  SESSION_ASSESSMENT_OPTIONS,
  SESSION_PLAN_OPTIONS,
  type SessionNotePayload,
} from '@/domain/sessionNote';
import type { Clinic, ConsultationNote, Patient, Therapist } from '@/domain/types';

const ASSESSMENT_LABEL = new Map(SESSION_ASSESSMENT_OPTIONS.map((o) => [o.value, o.label]));
const PLAN_LABEL = new Map(SESSION_PLAN_OPTIONS.map((o) => [o.value, o.label]));

export interface SessionLogSession {
  note: ConsultationNote;
  payload: SessionNotePayload;
}

/** Shared derivation for both this page and InsurerPacketPage.tsx — one
 *  enrollment's completed session notes plus the deduped list of every
 *  therapist who treated across them. */
export function buildSessionLog(
  enrollmentNotes: readonly ConsultationNote[],
  therapists: readonly Therapist[]
): {
  sessions: SessionLogSession[];
  therapistById: Map<string, Therapist>;
  treatingTherapists: Therapist[];
} {
  const sessions = enrollmentNotes
    .filter((n) => n.noteMode === 'session' && n.status === 'completed')
    .map((n) => ({ note: n, payload: upcastSessionPayload(n.assessmentPayload ?? {}) }));
  const therapistById = new Map(therapists.map((t) => [t.id, t]));
  const seen = new Map<string, Therapist>();
  for (const { note } of sessions) {
    const t = therapistById.get(note.therapistId);
    if (t && !seen.has(t.id)) seen.set(t.id, t);
  }
  return { sessions, therapistById, treatingTherapists: [...seen.values()] };
}

/**
 * The session log's letterhead-through-attestation content, with no
 * toolbar/back link of its own — extracted so InsurerPacketPage.tsx can
 * compose it alongside the heavy note and invoice sections in one print
 * job. SessionLogPrintPage wraps this with its own print toolbar.
 */
export function SessionLogContent({
  patient,
  clinic,
  sessions,
  therapistById,
  treatingTherapists,
  logoUrl,
  signatureUrl,
}: {
  patient: Patient;
  clinic: Clinic;
  sessions: SessionLogSession[];
  therapistById: Map<string, Therapist>;
  treatingTherapists: Therapist[];
  logoUrl: string | null;
  signatureUrl: string | null;
}) {
  return (
    <div className="mx-auto max-w-3xl bg-[var(--surface)] p-8 print:max-w-none print:p-0">
      {/* Letterhead */}
      <header className="flex items-start justify-between border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-3">
          {logoUrl && <img src={logoUrl} alt="" className="h-14 w-auto object-contain" />}
          <div>
            <h1 className="font-display text-xl font-bold text-[var(--ink)]">{clinic.name}</h1>
            {clinic.address && <p className="text-xs text-[var(--muted)]">{clinic.address}</p>}
            <p className="text-xs text-[var(--muted)]">
              {[clinic.phone, clinic.email].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      </header>

      <section className="mt-4 flex justify-between text-sm">
        <div>
          <p className="font-display font-semibold text-[var(--ink)]">{patient.name}</p>
          <p className="text-[var(--muted)]">Patient ID: {patient.mrno}</p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-[var(--ink)]">SESSION LOG</p>
          <p className="text-[var(--muted)]">
            {sessions.length} session{sessions.length === 1 ? '' : 's'}
          </p>
        </div>
      </section>

      {sessions.length === 0 ? (
        <p className="mt-6 text-sm text-[var(--muted)]">No completed session notes yet.</p>
      ) : (
        <>
          {/* Trend grid — structured columns only, so it stays a real
              matrix regardless of session count. */}
          <section className="mt-5 break-inside-avoid">
            <h2 className="border-b border-[var(--border)] pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Trend
            </h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-[var(--muted)]">
                    <th className="py-1 pr-2 font-semibold">Date</th>
                    <th className="py-1 pr-2 font-semibold">Therapist</th>
                    <th className="py-1 pr-2 font-semibold">Pain</th>
                    <th className="py-1 pr-2 font-semibold">Assessment</th>
                    <th className="py-1 pr-2 font-semibold">Plan</th>
                    <th className="py-1 font-semibold">Treatments</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(({ note, payload }) => (
                    <tr key={note.id} className="border-t border-[var(--border)]">
                      <td className="py-1 pr-2 text-[var(--ink)]">
                        {formatDateDMY(note.updatedAt)}
                      </td>
                      <td className="py-1 pr-2 text-[var(--ink)]">
                        {therapistById.get(note.therapistId)?.name ?? '—'}
                      </td>
                      <td className="py-1 pr-2 text-[var(--ink)]">
                        {payload.subjective.painNrs != null
                          ? `${payload.subjective.painNrs}/10`
                          : '—'}
                      </td>
                      <td className="py-1 pr-2 text-[var(--ink)]">
                        {payload.assessment ? ASSESSMENT_LABEL.get(payload.assessment) : '—'}
                      </td>
                      <td className="py-1 pr-2 text-[var(--ink)]">
                        {payload.plan ? PLAN_LABEL.get(payload.plan) : '—'}
                      </td>
                      <td className="py-1 text-[var(--ink)]">
                        {payload.intervention.treatments.join(', ') || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Narrative blocks — only sessions with a one-liner produce a
              block; a session documented purely by taps produces none. */}
          {sessions.some(({ payload }) => payload.subjective.oneLiner) && (
            <section className="mt-5">
              <h2 className="border-b border-[var(--border)] pb-1 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
                Notes
              </h2>
              <div className="mt-2 space-y-3">
                {sessions
                  .filter(({ payload }) => payload.subjective.oneLiner)
                  .map(({ note, payload }) => (
                    <div key={note.id} className="break-inside-avoid text-sm">
                      <p className="text-xs text-[var(--muted)]">
                        {formatDateDMY(note.updatedAt)} ·{' '}
                        {therapistById.get(note.therapistId)?.name ?? '—'}
                      </p>
                      <p className="text-[var(--ink)]">{payload.subjective.oneLiner}</p>
                      {payload.plan && (
                        <p className="text-xs text-[var(--muted)]">
                          Plan: {PLAN_LABEL.get(payload.plan)}
                        </p>
                      )}
                    </div>
                  ))}
              </div>
            </section>
          )}

          {/* One certifying attestation — not a signature per row, since
              no per-therapist signature field exists in the data model. */}
          <footer className="mt-12 border-t border-[var(--border)] pt-4 text-xs text-[var(--muted)]">
            <p className="text-[var(--ink)]">
              I certify the {sessions.length} session{sessions.length === 1 ? '' : 's'} above were
              delivered as recorded.
            </p>
            <div className="mt-3 flex items-end justify-between">
              <div>
                {treatingTherapists.map((t) => (
                  <p key={t.id}>
                    {t.name}
                    {t.registrationNo && ` · Reg. No. ${t.registrationNo}`}
                  </p>
                ))}
                <p>Generated {formatDateDMY(new Date().toISOString())}</p>
              </div>
              <div className="text-center">
                {signatureUrl ? (
                  <img
                    src={signatureUrl}
                    alt=""
                    className="mb-1 h-10 w-40 object-contain object-bottom"
                  />
                ) : (
                  <div className="mb-1 h-10 w-40 border-b border-[var(--border)]" />
                )}
                <p>Authorised signature</p>
              </div>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}

/**
 * Multi-visit session log (C6) — one enrollment's completed session notes,
 * printed as a compact trend grid, narrative blocks for the sessions that
 * have anything to say, and a single certifying attestation. Not a
 * per-session print view (see the print guard in NotePrintPage.tsx) — this
 * page is the only print surface for session-note content.
 */
export function SessionLogPrintPage() {
  const clinic = useClinic();
  const { patientId, enrollmentId } = useParams({ strict: false }) as {
    patientId: string;
    enrollmentId: string;
  };
  const { from: backTo } = useSearch({ strict: false }) as { from?: PatientProfileBackTarget };
  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const enrollmentNotes = useLiveQuery(
    () => repos.consultationNotes.listByEnrollment(enrollmentId),
    [enrollmentId]
  );
  const [paper, setPaper] = useState<'A4' | 'A5'>('A4');

  const logoUrl = useMemo(() => publicLogoUrl(clinic.logoPath), [clinic.logoPath]);
  const signatureUrl = useMemo(() => publicLogoUrl(clinic.signaturePath), [clinic.signaturePath]);

  useEffect(() => {
    if (!patient) return;
    const previousTitle = document.title;
    document.title = `${patient.name} - Session log`;
    return () => {
      document.title = previousTitle;
    };
  }, [patient]);

  const { sessions, therapistById, treatingTherapists } = useMemo(
    () => buildSessionLog(enrollmentNotes ?? [], therapists ?? []),
    [enrollmentNotes, therapists]
  );

  if (patient === undefined) {
    return (
      <div className="p-8 text-sm text-[var(--muted)]">Patient not found (or not yet synced).</div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--paper)] print:bg-[var(--surface)]">
      <style>{`@page { size: ${paper}; margin: ${paper === 'A5' ? '10mm' : '16mm'}; }`}</style>

      <div className="no-print mx-auto flex max-w-3xl items-center gap-2 px-4 py-3">
        <Link
          to="/patients/$patientId"
          params={{ patientId: patient.id }}
          search={backTo ? { from: backTo } : undefined}
          className={btnSecondary}
        >
          ← Back
        </Link>
        <div className="ml-auto flex items-center gap-2">
          <select
            className={inputCls}
            value={paper}
            onChange={(e) => setPaper(e.target.value as 'A4' | 'A5')}
          >
            <option value="A4">A4</option>
            <option value="A5">A5</option>
          </select>
          <button type="button" className={btnPrimary} onClick={() => window.print()}>
            Print / Save PDF
          </button>
        </div>
      </div>

      <SessionLogContent
        patient={patient}
        clinic={clinic}
        sessions={sessions}
        therapistById={therapistById}
        treatingTherapists={treatingTherapists}
        logoUrl={logoUrl}
        signatureUrl={signatureUrl}
      />
    </div>
  );
}
