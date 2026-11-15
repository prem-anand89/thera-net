// HEP > Programs: every patient's program in one list, most urgent first. The table (tablet and up) and the phone cards
// are drawn from the same rows (programRows.ts), so they never disagree. Programs live on the server: this tab needs a
// connection. "Message" and "Prescribe next" open sheets that belong to the patient chart work and appear once wired.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useClinic } from '@/app/clinicContext';
import { useWorkspaceScope } from '@/app/useWorkspaceScope';
import { Button } from '@/components/Button';
import { useMediaQuery } from '@/components/useMediaQuery';
import {
  ChipCount, ConfirmDialog, ErrorNote, KebabMenu, LoadingRows, SheetDialog, btnPrimary, btnSecondary, cellSub, filterChip, inputCls, menuItem, pillSmAccent, pillSmNeutral, pillSmPrimary, segOption, segTrack, td, th,
} from '@/components/ui';
import { clinicCountryCode } from '@/domain/clinicRegion';
import { addDaysISO } from '@/domain/hep';
import { hepService, type ProgramBundle } from '@/services/hepService';
import { EXTEND_DAYS, buildProgramRow, countBuckets, filterRows, matchesProgramSearch, sortRows, telHref, type ProgramBucket, type ProgramRow, type SignalTone } from './programRows';
import { DayStrip } from './DayStrip';
import { clinicToday, useOnline } from './useHepData';

const TAB_MEDIA_QUERY = '(min-width: 46.5rem)';
const WINDOW_DAYS = 14;
const FILTERS: Array<{ key: ProgramBucket; label: string }> = [
  { key: 'attention', label: 'Needs attention' }, { key: 'active', label: 'Active' }, { key: 'ending', label: 'Ending this week' }, { key: 'ended', label: 'Recently ended' }, { key: 'past', label: 'Archived' },
];
const TONE_CLASS: Record<SignalTone, string> = {
  red: 'bg-[var(--rust-light)] text-[var(--rust)]',
  amber: 'bg-[var(--amber-light)] text-[var(--amber-strong)]',
  blue: 'bg-[var(--sky-light,var(--teal-light))] text-[var(--sky,var(--teal-strong))]',
  green: 'bg-[var(--moss-light,var(--teal-light))] text-[var(--moss,var(--teal-strong))]',
  grey: 'bg-[var(--paper)] text-[var(--muted)]',
};

export interface ProgramsTabProps {
  /** "Message" on an active program: the Message patient presets. Hidden when absent. */
  onMessage?: (row: ProgramRow, bundle: ProgramBundle) => void;
  /** "Prescribe next" (ended) and "Prescribe again" (past): the program sheet for the same patient, starting from this program. Hidden when absent. */
  onPrescribeNext?: (row: ProgramRow, bundle: ProgramBundle) => void;
  /** Change this number to load the list again (after a program was saved elsewhere). */
  reloadKey?: number;
}

function Signals({ row }: { row: ProgramRow }) {
  if (row.signals.length === 0) return <span className={cellSub}>—</span>;
  return (
    <ul className="flex flex-wrap gap-1">
      {row.signals.map((s) => <li key={s.key} className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[s.tone]}`}>{s.label}</li>)}
    </ul>
  );
}

const todayLabel = (r: ProgramRow) => (r.todayTarget > 0 ? `${r.todayCompleted} of ${r.todayTarget} sessions` : '—');
const habitLabel = (r: ProgramRow) => (r.habitPercent == null ? 'Not enough data' : `${r.habitPercent}%`);

function Adherence({ row }: { row: ProgramRow }) {
  return (
    <div className="space-y-1">
      <DayStrip days={row.days} />
      <div className={cellSub}>{habitLabel(row)}</div>
    </div>
  );
}
const programLine = (r: ProgramRow) => `${r.exerciseCount} ${r.exerciseCount === 1 ? 'exercise' : 'exercises'} · ${r.dayLabel}`;

export function ProgramsTab({ onMessage, onPrescribeNext, reloadKey = 0 }: ProgramsTabProps) {
  const clinic = useClinic();
  const online = useOnline();
  const scope = useWorkspaceScope();
  const wide = useMediaQuery(TAB_MEDIA_QUERY);
  const [bundles, setBundles] = useState<ProgramBundle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState<'mine' | 'all' | null>(null);
  const [filter, setFilter] = useState<ProgramBucket>('attention');
  const [query, setQuery] = useState('');
  const [completing, setCompleting] = useState<ProgramRow | null>(null);
  const [extending, setExtending] = useState<ProgramRow | null>(null);
  const [busy, setBusy] = useState(false);

  const today = clinicToday(clinic);
  const windowStart = addDaysISO(today, -WINDOW_DAYS);
  const showOwner = owner ?? (scope.isAdmin ? 'all' : 'mine');

  const load = useCallback(async () => {
    try {
      setError(null);
      setBundles(await hepService.listClinicPrograms(clinic.id, addDaysISO(clinicToday(clinic), -WINDOW_DAYS)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the programs.');
      setBundles((cur) => cur ?? []);
    }
  }, [clinic]);
  useEffect(() => { if (online) void load(); }, [online, load, reloadKey]);

  const bundleOf = useCallback((id: string) => (bundles ?? []).find((b) => b.program.id === id) as ProgramBundle, [bundles]);
  const allRows = useMemo(() => (bundles ?? []).map((b) => buildProgramRow(b, { today, windowStart })), [bundles, today, windowStart]);
  const ownedRows = useMemo(() => (showOwner === 'mine' ? allRows.filter((r) => r.therapistId != null && r.therapistId === scope.myTherapistId) : allRows), [allRows, showOwner, scope.myTherapistId]);
  const counts = useMemo(() => countBuckets(ownedRows), [ownedRows]);
  const shown = useMemo(() => sortRows(filterRows(ownedRows, filter).filter((r) => matchesProgramSearch(r, query))), [ownedRows, filter, query]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    try { setError(null); await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'That did not work. Try again.'); } finally { setBusy(false); }
  }

  const menu = (r: ProgramRow) => (
    <KebabMenu ariaLabel={`Actions for ${r.patientName}, ${r.title}`}>
      {(close) => (
        <>
          <Link to="/patients/$patientId" params={{ patientId: r.patientId }} className={menuItem} onClick={close}>Open Home program</Link>
          {r.status === 'active' && !r.ended && <button type="button" className={menuItem} onClick={() => { close(); void act(() => hepService.setProgramStatus(r.id, 'paused')); }}>Pause</button>}
          {r.status === 'paused' && <button type="button" className={menuItem} onClick={() => { close(); void act(() => hepService.setProgramStatus(r.id, 'active')); }}>Resume</button>}
          {r.status !== 'completed' && r.durationDays != null && <button type="button" className={menuItem} onClick={() => { close(); setExtending(r); }}>Extend</button>}
          {r.status !== 'completed' && <button type="button" className={menuItem} onClick={() => { close(); setCompleting(r); }}>Mark completed</button>}
          {r.status === 'completed' && onPrescribeNext && <button type="button" className={menuItem} onClick={() => { close(); onPrescribeNext(r, bundleOf(r.id)); }}>Prescribe again</button>}
          {r.status === 'completed' && <button type="button" className={menuItem} onClick={() => { close(); void act(() => hepService.duplicateProgram(r.id)); }}>Duplicate</button>}
        </>
      )}
    </KebabMenu>
  );

  const primary = (r: ProgramRow) => {
    if (r.status === 'completed') return null;
    if (r.ended) return onPrescribeNext ? <Button type="button" className={pillSmPrimary} onClick={() => onPrescribeNext(r, bundleOf(r.id))}>Prescribe next</Button> : null;
    // The first alert decides: red calls, amber messages, anything else just opens the chart.
    const tone = r.signals[0]?.tone;
    const tel = tone === 'red' ? telHref(r.patientPhone, clinicCountryCode(clinic)) : null;
    if (tel) return <a href={tel} className={`${pillSmPrimary} inline-flex items-center`}>Call</a>;
    if (tone === 'amber' && onMessage) return <Button type="button" className={pillSmAccent} onClick={() => onMessage(r, bundleOf(r.id))}>Message</Button>;
    return <Link to="/patients/$patientId" params={{ patientId: r.patientId }} className={`${pillSmNeutral} inline-flex items-center`}>Open</Link>;
  };

  if (!online && bundles === null) return <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">Programs need a connection. Reconnect to see them.</p>;
  if (bundles === null) return <LoadingRows rows={4} label="Loading programs" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className={segTrack} role="group" aria-label="Whose programs">
          <button type="button" aria-pressed={showOwner === 'mine'} className={segOption(showOwner === 'mine')} onClick={() => setOwner('mine')}>My patients</button>
          <button type="button" aria-pressed={showOwner === 'all'} className={segOption(showOwner === 'all')} onClick={() => setOwner('all')}>All therapists</button>
        </div>
        <input type="search" aria-label="Search programs" placeholder="Search patient or program" className={`${inputCls} max-w-xs`} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter programs">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} className={filterChip(filter === f.key)} onClick={() => setFilter(f.key)}>{f.label}<ChipCount n={counts[f.key]} /></button>
        ))}
      </div>
      <ErrorNote message={error} />

      {shown.length === 0 && (
        <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
          {allRows.length === 0 ? 'No programs yet. Prescribe one from a patient\'s chart, or use a template.'
            : query ? `No programs match “${query}”.`
            : filter === 'attention' ? 'Nothing needs attention right now.'
            : 'Nothing here.'}
        </p>
      )}

      {shown.length > 0 && wide && (
        <div className="overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[56rem] border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className={th}>Patient</th><th className={th}>Program</th>{showOwner === 'all' && <th className={th}>Therapist</th>}
                <th className={th}>Today</th><th className={th}>Adherence, last 14 days</th><th className={th}>Alerts</th><th className={th}>Last active</th><th className={th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {shown.map((r) => (
                <tr key={r.id}>
                  <td className={td}><Link to="/patients/$patientId" params={{ patientId: r.patientId }} className="font-medium text-[var(--teal-strong)] hover:underline">{r.patientName}</Link><div className={cellSub}>{r.startedLabel}</div></td>
                  <td className={td}>{r.title}<div className={cellSub}>{programLine(r)}</div></td>
                  {showOwner === 'all' && <td className={td}>{r.therapistName ?? '—'}</td>}
                  <td className={td}>{todayLabel(r)}</td>
                  <td className={td}><Adherence row={r} /></td>
                  <td className={td}><Signals row={r} /></td>
                  <td className={td}>{r.lastActiveLabel}</td>
                  <td className={td}><div className="flex items-center justify-end gap-2">{primary(r)}{menu(r)}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {shown.length > 0 && !wide && (
        <ul className="space-y-2">
          {shown.map((r) => (
            <li key={r.id} className="space-y-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Link to="/patients/$patientId" params={{ patientId: r.patientId }} className="block truncate font-medium text-[var(--teal-strong)]">{r.patientName}</Link>
                  <p className="truncate text-sm text-[var(--ink)]">{r.title}</p>
                  <p className={cellSub}>{programLine(r)} · {r.startedLabel}</p>
                </div>
                {menu(r)}
              </div>
              <p className="text-sm text-[var(--ink)]">{todayLabel(r)}</p>
              <Adherence row={r} />
              <p className={cellSub}>Last active: {r.lastActiveLabel}{showOwner === 'all' && r.therapistName ? ` · ${r.therapistName}` : ''}</p>
              <Signals row={r} />
              {primary(r) && <div>{primary(r)}</div>}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={completing !== null}
        title="Mark this program completed?"
        message={`“${completing?.title ?? ''}” for ${completing?.patientName ?? ''} moves to Past. The patient's page stops showing it.`}
        confirmLabel="Mark completed"
        onConfirm={() => { const r = completing; setCompleting(null); if (r) void act(() => hepService.setProgramStatus(r.id, 'completed')); }}
        onCancel={() => setCompleting(null)}
      />
      <SheetDialog
        open={extending !== null}
        title="Extend this program"
        busy={busy}
        onClose={() => setExtending(null)}
        footer={<Button type="button" className={btnSecondary} onClick={() => setExtending(null)}>Cancel</Button>}
      >
        <p className="mb-3 text-sm text-[var(--muted)]">Keep “{extending?.title}” going for {extending?.patientName}. Add:</p>
        <div className="flex flex-wrap gap-2">
          {EXTEND_DAYS.map((n) => (
            <Button key={n} type="button" className={btnPrimary} disabled={busy} onClick={() => { const r = extending; setExtending(null); if (r) void act(() => hepService.extendProgram(r.id, n)); }}>{n} days</Button>
          ))}
        </div>
      </SheetDialog>
    </div>
  );
}
