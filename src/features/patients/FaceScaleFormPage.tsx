import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import type { SideAffected } from '@/domain/types';
import {
  computeFaceScale,
  faceScaleFlags,
  faceScaleInterpretation,
  type FaceScaleResponses,
} from '@/domain/instruments/faceScale';
import { Field, SectionCard, btnPrimary, btnSecondary, ErrorNote, inputCls } from '@/components/ui';

/**
 * Items and option labels ported verbatim from FaCE_Original_iPad.html so
 * the wording clinicians see matches the source tool exactly.
 */
const SECTIONS: {
  title: string;
  note: string;
  opts: [string, string, string, string, string];
  questions: { n: number; text: string }[];
}[] = [
  {
    title: 'Section 1 — Facial Movement',
    note: 'Rate how well you can move your face. Select the option that best describes your experience in the past week.',
    opts: ['Not at all', 'Only if I concentrate', 'A little', 'Almost normally', 'Normally'],
    questions: [
      { n: 1, text: 'When I smile, the affected side of my mouth goes up' },
      { n: 2, text: 'I can raise my eyebrow on the affected side' },
      { n: 3, text: 'When I pucker my lips, the affected side of my mouth moves' },
    ],
  },
  {
    title: 'Section 2 — How often in the past week',
    note: 'These questions are about how often you experienced each situation because of your face or facial problem in the past week.',
    opts: ['All of the time', 'Most of the time', 'Some of the time', 'A little of the time', 'None of the time'],
    questions: [
      { n: 4, text: 'Parts of my face feel tight, worn out, or uncomfortable' },
      { n: 5, text: 'My affected eye feels dry, irritated, or scratchy' },
      { n: 6, text: 'When I try to move my face, I feel tension, pain or spasm' },
      { n: 7, text: 'I use eye drops or ointment in my affected eye' },
      { n: 8, text: 'My affected eye is wet or has tears in it' },
      { n: 9, text: 'I act differently around people because of my face or facial problem' },
      { n: 10, text: 'People treat me differently because of my face or facial problem' },
      { n: 11, text: 'I have problems moving food around in my mouth' },
      { n: 12, text: 'I have problems with drooling or keeping food or drink in my mouth or off my chin and clothes' },
    ],
  },
  {
    title: 'Section 3 — How much you agree',
    note: 'Rate how much you agree with each statement about your face or facial problem in the past week.',
    opts: ['Strongly agree', 'Agree', "Don't know", 'Disagree', 'Strongly disagree'],
    questions: [
      { n: 13, text: 'My face feels tired or when I try to move my face, I feel tension, pain, or spasm' },
      { n: 14, text: 'My appearance has affected my willingness to participate in social activities or to see family or friends' },
      { n: 15, text: "Because of difficulty with the way I eat, I have avoided eating in restaurants or in other people's homes" },
    ],
  },
];

const FLAG_TONE: Record<string, string> = {
  red: 'border-[var(--rust)] bg-[var(--rust-light)] text-[var(--rust)]',
  amber: 'border-[var(--rust)] bg-[var(--rust-light)] text-[var(--rust)]',
  green: 'border-[var(--teal)] bg-[var(--paper)] text-[var(--ink)]',
};

export function FaceScaleFormPage() {
  const clinic = useClinic();
  const navigate = useNavigate();
  const { patientId } = useParams({ strict: false }) as { patientId: string };
  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);

  const [sideAffected, setSideAffected] = useState<SideAffected | ''>('');
  const [visitLabel, setVisitLabel] = useState('');
  const [responses, setResponses] = useState<FaceScaleResponses>({});
  const [vasMovement, setVasMovement] = useState<number | null>(null);
  const [vasQol, setVasQol] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReturnType<typeof computeFaceScale> | null>(null);

  const allAnswered = SECTIONS.every((s) => s.questions.every((q) => responses[q.n] !== undefined));
  const canSubmit = allAnswered && vasMovement !== null && vasQol !== null;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const computed = computeFaceScale(responses);
      await repos.faceScale.put({
        id: crypto.randomUUID(),
        clinicId: clinic.id,
        patientId,
        enrollmentId: null,
        sideAffected: sideAffected || null,
        visitLabel: visitLabel.trim() || null,
        responses,
        vasMovement,
        vasQol,
        domainScores: computed.domainScores,
        totalScore: computed.total,
        updatedAt: new Date().toISOString(),
      });
      setResult(computed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!patient) {
    return <div className="p-8 text-sm text-[var(--muted)]">Patient not found (or not yet synced).</div>;
  }

  if (result) {
    const interp = faceScaleInterpretation(result.total);
    const flags = faceScaleFlags(result.domainScores, vasQol);
    return (
      <div className="space-y-4">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">FaCE Scale — {patient.name}</h1>
        <SectionCard title={`Total score: ${result.total}/100`}>
          <p className="mb-3 text-sm text-[var(--ink)]">
            <strong>{interp.title}</strong> — {interp.description}
          </p>
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(result.domainScores).map(([k, v]) => (
                <tr key={k} className="border-b border-[var(--border)] last:border-0">
                  <td className="py-1 text-[var(--muted)]">{k.replace(/([A-Z])/g, ' $1').trim()}</td>
                  <td className="py-1 text-right font-medium text-[var(--ink)]">{v}/100</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
        <SectionCard title="Clinical flags">
          <div className="space-y-2">
            {flags.map((f, i) => (
              <div key={i} className={`rounded-md border px-3 py-2 text-sm ${FLAG_TONE[f.color]}`}>
                {f.text}
              </div>
            ))}
          </div>
        </SectionCard>
        <button
          className={btnPrimary}
          onClick={() => navigate({ to: '/patients/$patientId', params: { patientId } })}
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)]">FaCE Scale — {patient.name}</h1>
      <p className="text-xs text-[var(--muted)]">
        15 questions about your face and facial problem over the past week, plus 2 overall ratings.
      </p>

      <SectionCard title="Assessment details">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Side affected">
            <select
              className={inputCls}
              value={sideAffected}
              onChange={(e) => setSideAffected(e.target.value as SideAffected | '')}
            >
              <option value="">Select</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
              <option value="both">Both</option>
            </select>
          </Field>
          <Field label="Visit / week">
            <input
              className={inputCls}
              value={visitLabel}
              onChange={(e) => setVisitLabel(e.target.value)}
              placeholder="e.g. Week 3"
            />
          </Field>
        </div>
      </SectionCard>

      {SECTIONS.map((section) => (
        <SectionCard key={section.title} title={section.title}>
          <p className="mb-3 text-xs text-[var(--muted)]">{section.note}</p>
          <div className="space-y-4">
            {section.questions.map((q) => (
              <div key={q.n}>
                <div className="mb-2 text-sm text-[var(--ink)]">
                  <span className="mr-1.5 inline-block rounded-full bg-[var(--ink)] px-2 py-0.5 text-xs font-semibold text-white">
                    {q.n}
                  </span>
                  {q.text}
                </div>
                <div className="grid grid-cols-5 gap-1.5">
                  {section.opts.map((label, i) => {
                    const v = (i + 1) as 1 | 2 | 3 | 4 | 5;
                    const sel = responses[q.n] === v;
                    return (
                      <button
                        key={v}
                        type="button"
                        onClick={() => setResponses((r) => ({ ...r, [q.n]: v }))}
                        className={`rounded-md border px-1 py-2 text-center text-[11px] leading-tight ${
                          sel
                            ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                            : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--ink)]'
                        }`}
                      >
                        <div className="font-semibold">{v}</div>
                        <div>{label}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ))}

      <SectionCard title="Overall ratings">
        <div className="space-y-4">
          <div>
            <div className="mb-2 text-sm text-[var(--ink)]">
              In general, how would you rate your overall <strong>facial movement</strong>?
            </div>
            <VasRow value={vasMovement} onChange={setVasMovement} lowLabel="No movement" highLabel="Normal movement" />
          </div>
          <div>
            <div className="mb-2 text-sm text-[var(--ink)]">
              In general, how much has your facial problem affected your <strong>quality of life</strong>?
            </div>
            <VasRow value={vasQol} onChange={setVasQol} lowLabel="No effect" highLabel="Extreme effect" />
          </div>
        </div>
      </SectionCard>

      <ErrorNote message={error} />

      <div className="flex gap-2">
        <button
          className={btnSecondary}
          onClick={() => navigate({ to: '/patients/$patientId', params: { patientId } })}
        >
          Cancel
        </button>
        <button className={btnPrimary} disabled={!canSubmit || busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Calculate scores'}
        </button>
      </div>
    </div>
  );
}

function VasRow({
  value,
  onChange,
  lowLabel,
  highLabel,
}: {
  value: number | null;
  onChange: (v: number) => void;
  lowLabel: string;
  highLabel: string;
}) {
  return (
    <div>
      <div className="flex gap-1">
        {Array.from({ length: 11 }, (_, i) => i).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`flex-1 rounded-md border px-1 py-2 text-center text-sm font-semibold ${
              value === v
                ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--ink)]'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-[var(--muted)]">
        <span>0 — {lowLabel}</span>
        <span>10 — {highLabel}</span>
      </div>
    </div>
  );
}
