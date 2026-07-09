import { useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import type { SideAffected } from '@/domain/types';
import {
  HB_GRADES,
  SB_RESTING_ITEMS,
  SB_VOLUNTARY_ITEMS,
  SB_SYNKINESIS_ITEMS,
  computeSunnybrook,
  sunnybrookInterpretation,
  synkinesisSeverity,
  facialPalsyFlags,
  type SunnybrookRestingScores,
  type SunnybrookVoluntaryScores,
  type SunnybrookSynkinesisScores,
} from '@/domain/instruments/facialPalsy';
import { Field, SectionCard, btnPrimary, btnSecondary, ErrorNote, inputCls } from '@/components/ui';

const REST_LABELS: Record<string, string> = {
  r0: 'Eye (palpebral fissure)',
  r1: 'Cheek (nasolabial fold)',
  r2: 'Mouth (corner position)',
};
const VOL_LABELS: Record<string, string> = {
  v0: 'Brow raise (frontalis)',
  v1: 'Gentle eye closure',
  v2: 'Open mouth smile',
  v3: 'Snarl / lip elevation',
  v4: 'Lip pucker',
};
const SYN_LABELS: Record<string, string> = {
  s0: 'Synkinesis with brow raise',
  s1: 'Synkinesis with eye closure',
  s2: 'Synkinesis with open smile',
  s3: 'Synkinesis with snarl',
  s4: 'Synkinesis with lip pucker',
};

const FLAG_TONE: Record<string, string> = {
  red: 'border-[var(--rust)] bg-[var(--rust-light)] text-[var(--rust)]',
  purple: 'border-[var(--rust)] bg-[var(--rust-light)] text-[var(--rust)]',
  blue: 'border-[var(--teal)] bg-[var(--paper)] text-[var(--ink)]',
  green: 'border-[var(--teal)] bg-[var(--paper)] text-[var(--ink)]',
};

function ScoreRow({
  label,
  min,
  max,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  value: number | undefined;
  onChange: (v: number) => void;
}) {
  const range = Array.from({ length: max - min + 1 }, (_, i) => min + i);
  return (
    <div className="mb-3 flex items-center gap-3">
      <div className="flex-1 text-sm text-[var(--ink)]">{label}</div>
      <div className="flex gap-1">
        {range.map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`h-8 w-8 rounded-full border text-xs font-semibold ${
              value === v
                ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                : 'border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:border-[var(--ink)]'
            }`}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FacialPalsyFormPage() {
  const clinic = useClinic();
  const navigate = useNavigate();
  const { patientId } = useParams({ strict: false }) as { patientId: string };
  const patient = useLiveQuery(() => repos.patients.get(patientId), [patientId]);

  const [sideAffected, setSideAffected] = useState<SideAffected | ''>('');
  const [visitLabel, setVisitLabel] = useState('');
  const [hbGrade, setHbGrade] = useState<number | null>(null);
  const [resting, setResting] = useState<SunnybrookRestingScores>({});
  const [voluntary, setVoluntary] = useState<SunnybrookVoluntaryScores>({});
  const [synkinesis, setSynkinesis] = useState<SunnybrookSynkinesisScores>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const sunnybrook = computeSunnybrook(resting, voluntary, synkinesis);
  const canSubmit = hbGrade !== null && sunnybrook.score !== null;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await repos.facialPalsy.put({
        id: crypto.randomUUID(),
        clinicId: clinic.id,
        patientId,
        enrollmentId: null,
        sideAffected: sideAffected || null,
        visitLabel: visitLabel.trim() || null,
        hbGrade,
        sunnybrookResting: resting as Record<string, number>,
        sunnybrookVoluntary: voluntary as Record<string, number>,
        sunnybrookSynkinesis: synkinesis as Record<string, number>,
        sunnybrookScore: sunnybrook.score,
        synkinesisTotal: sunnybrook.synkinesisTotal,
        updatedAt: new Date().toISOString(),
      });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!patient) {
    return <div className="p-8 text-sm text-[var(--muted)]">Patient not found (or not yet synced).</div>;
  }

  if (saved && sunnybrook.score !== null && hbGrade !== null) {
    const hb = HB_GRADES[hbGrade - 1];
    const interp = sunnybrookInterpretation(sunnybrook.score);
    const flags = facialPalsyFlags(hbGrade, sunnybrook.score, sunnybrook.synkinesisTotal);
    return (
      <div className="space-y-4">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Facial Palsy — {patient.name}</h1>
        <SectionCard title={`House–Brackmann Grade ${hb.grade} — ${hb.label}`}>
          <p className="mb-2 text-sm text-[var(--ink)]">{hb.description}</p>
          <p className="text-sm text-[var(--ink)]">
            <strong>Management:</strong> {hb.management}
          </p>
          <p className="text-sm text-[var(--ink)]">
            <strong>Prognosis:</strong> {hb.prognosis}
          </p>
        </SectionCard>
        <SectionCard title={`Sunnybrook score: ${sunnybrook.score}/100`}>
          <p className="text-sm text-[var(--ink)]">
            <strong>{interp.title}</strong> — {interp.description}
          </p>
          <p className="mt-2 text-sm text-[var(--ink)]">
            Synkinesis: {sunnybrook.synkinesisTotal}/12 ({synkinesisSeverity(sunnybrook.synkinesisTotal ?? 0)})
          </p>
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
      <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Facial Palsy — {patient.name}</h1>
      <p className="text-xs text-[var(--muted)]">House–Brackmann grade + Sunnybrook Facial Grading.</p>

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
              placeholder="e.g. Week 2"
            />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="House–Brackmann grade">
        <div className="grid grid-cols-3 gap-2">
          {HB_GRADES.map((h) => (
            <button
              key={h.grade}
              type="button"
              onClick={() => setHbGrade(h.grade)}
              className={`rounded-md border px-2 py-3 text-center ${
                hbGrade === h.grade
                  ? 'border-[var(--ink)] bg-[var(--ink)] text-white'
                  : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)] hover:border-[var(--ink)]'
              }`}
            >
              <div className="text-lg font-bold">{h.grade}</div>
              <div className="text-xs">{h.label}</div>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Sunnybrook — Section A: Resting symmetry (0 = normal · 4 = severe)">
        {SB_RESTING_ITEMS.map((id) => (
          <ScoreRow
            key={id}
            label={REST_LABELS[id]}
            min={0}
            max={4}
            value={resting[id]}
            onChange={(v) => setResting((r) => ({ ...r, [id]: v }))}
          />
        ))}
      </SectionCard>

      <SectionCard title="Sunnybrook — Section B: Voluntary movement (1 = no movement · 5 = normal)">
        {SB_VOLUNTARY_ITEMS.map((id) => (
          <ScoreRow
            key={id}
            label={VOL_LABELS[id]}
            min={1}
            max={5}
            value={voluntary[id]}
            onChange={(v) => setVoluntary((r) => ({ ...r, [id]: v }))}
          />
        ))}
      </SectionCard>

      <SectionCard title="Sunnybrook — Section C: Synkinesis (0 = none · 3 = disfiguring)">
        {SB_SYNKINESIS_ITEMS.map((id) => (
          <ScoreRow
            key={id}
            label={SYN_LABELS[id]}
            min={0}
            max={3}
            value={synkinesis[id]}
            onChange={(v) => setSynkinesis((r) => ({ ...r, [id]: v }))}
          />
        ))}
      </SectionCard>

      {sunnybrook.score !== null && (
        <SectionCard title="Live Sunnybrook score">
          <div className="text-2xl font-bold text-[var(--ink)]">{sunnybrook.score} / 100</div>
        </SectionCard>
      )}

      <ErrorNote message={error} />

      <div className="flex gap-2">
        <button
          className={btnSecondary}
          onClick={() => navigate({ to: '/patients/$patientId', params: { patientId } })}
        >
          Cancel
        </button>
        <button className={btnPrimary} disabled={!canSubmit || busy} onClick={() => void submit()}>
          {busy ? 'Saving…' : 'Save assessment'}
        </button>
      </div>
    </div>
  );
}
