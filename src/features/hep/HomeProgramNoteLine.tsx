// Inside a consultation or session note: the patient's digital program in one line, a link to its tab on the chart, and a
// Home program button that opens the program sheet starting on the visit's date. This is a doorway only: it reads and
// writes nothing in the note, so opening or cancelling the sheet never marks the note as changed. Clinical staff only.
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useClinic } from '@/app/clinicContext';
import { usePermissions } from '@/app/usePermissions';
import { Button } from '@/components/Button';
import { btnSecondary } from '@/components/ui';
import { addDaysISO } from '@/domain/hep';
import { hepService } from '@/services/hepService';
import { ProgramSheet } from './ProgramSheet';
import { buildProgramRow, type ProgramRow } from './programRows';
import { clinicToday, useOnline } from './useHepData';

export function HomeProgramNoteLine({ patientId, startDate }: { patientId: string; /** The visit's date (YYYY-MM-DD). */ startDate?: string | null }) {
  const clinic = useClinic();
  const { canUseExercises } = usePermissions();
  const online = useOnline();
  const [row, setRow] = useState<ProgramRow | null>(null);
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!canUseExercises || !online) return;
    let live = true;
    const today = clinicToday(clinic);
    const windowStart = addDaysISO(today, -14);
    hepService.listPatientPrograms(patientId, windowStart)
      .then((list) => { const cur = list.find((b) => b.program.status !== 'completed'); if (live) setRow(cur ? buildProgramRow(cur, { today, windowStart }) : null); })
      .catch(() => { if (live) setRow(null); });
    return () => { live = false; };
  }, [patientId, canUseExercises, online, clinic, reload]);

  if (!canUseExercises) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-[var(--paper)] p-3 text-sm" data-testid="home-program-note-line">
      <span className="min-w-0 flex-1 text-[var(--ink)]">
        {row ? <>Digital program: {row.title}, {row.dayLabel.toLowerCase()}{row.habitPercent != null ? `, ${row.habitPercent}%` : ''}</> : 'No digital program yet.'}
      </span>
      {row && <Link to="/patients/$patientId" params={{ patientId }} search={{ view: 'home-program' }} className="text-[var(--teal)] hover:underline">Open Home program</Link>}
      <Button type="button" className={btnSecondary} disabled={!online} onClick={() => setOpen(true)}>Home program</Button>
      <ProgramSheet open={open} mode="new" patientId={patientId} startDate={startDate ?? undefined} onClose={() => setOpen(false)} onSaved={() => setReload((n) => n + 1)} />
    </div>
  );
}
