// The patient chart's Home program tab: one program at a time (a switcher for several), what needs attention, how the
// patient is doing (today, habit, streak, the 14-day strip and each day's sessions), by section and by exercise, and the
// patient's link. Opening it marks any new pain report as seen for everyone, but the report stays on screen for this
// visit ("Reviewed ✓ just now"). Programs live on the server: this tab needs a connection.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { Button } from '@/components/Button';
import { ConfirmDialog, ErrorNote, KebabMenu, LoadingRows, SheetDialog, btnPrimary, btnSecondary, filterChip, inputCls, menuItem, menuItemDestructive, pillSmAccent, pillSmNeutral, pillSmPrimary } from '@/components/ui';
import { clinicTimezone } from '@/domain/clinicRegion';
import { EXERCISE_PHASE_LABELS, addDaysISO, estimateSessionMinutes, sectionAdherence } from '@/domain/hep';
import { describeDose } from '@/domain/hepDose';
import { repos } from '@/services';
import { hepService, type ProgramBundle } from '@/services/hepService';
import type { Patient } from '@/domain/types';
import { HandOverPanel } from './HandOverPanel';
import { itemDose, programItemToInput } from './hepItems';
import { buildHepPortalUrl, buildHepWhatsAppShareUrl } from './hepSharing';
import { SKIP_REASON_LABEL, currentStreak, dayStrip, dayTimeline, itemsInSessionOrder, trendSeries } from './homeProgram';
import { CELL_CLASS, CELL_WORD } from './DayStrip';
import { itemProgress, itemProgressLine } from './itemProgress';
import { MessagePatientSheet } from './MessagePatientSheet';
import { SESSION_LABEL } from './ProgramItemsEditor';
import { PrintSheet } from './PrintSheet';
import { ProgramSheet } from './ProgramSheet';
import { EXTEND_DAYS, buildProgramRow } from './programRows';
import { clinicToday, useOnline } from './useHepData';

const WINDOW_DAYS = 30;

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="font-num text-lg font-semibold text-[var(--ink)]">{value}</p>
      {sub && <p className="text-xs text-[var(--muted)]">{sub}</p>}
    </div>
  );
}

export function HomeProgramTab({ patientId }: { patientId: string }) {
  const clinic = useClinic();
  const online = useOnline();
  const today = clinicToday(clinic);
  const tz = clinicTimezone(clinic);
  const [patient, setPatient] = useState<Patient | null>(null);
  const [bundles, setBundles] = useState<ProgramBundle[] | null>(null);
  const [shownId, setShownId] = useState<string | null>(null);
  const [day, setDay] = useState<string>(today);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<null | { mode: 'new' | 'edit' }>(null);
  const [messaging, setMessaging] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [extending, setExtending] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [handOver, setHandOver] = useState<{ pin: string } | null>(null);
  const [painSeen, setPainSeen] = useState<Record<string, string>>({});
  const marked = useRef(new Set<string>());

  useEffect(() => { void repos.patients.get(patientId).then((p) => setPatient(p ?? null)).catch(() => {}); }, [patientId]);

  const load = useCallback(async () => {
    try {
      setError(null);
      const list = await hepService.listPatientPrograms(patientId, addDaysISO(clinicToday(clinic), -WINDOW_DAYS));
      setBundles(list);
      setShownId((cur) => cur && list.some((b) => b.program.id === cur) ? cur : (list.find((b) => b.program.status !== 'completed') ?? list[0])?.program.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the home program.');
      setBundles((cur) => cur ?? []);
    }
  }, [patientId, clinic]);
  useEffect(() => { if (online) void load(); }, [online, load]);

  const current = bundles?.find((b) => b.program.id === shownId) ?? null;
  const row = useMemo(() => (current ? buildProgramRow(current, { today, windowStart: addDaysISO(today, -WINDOW_DAYS) }) : null), [current, today]);

  // Opening the program marks new pain as seen for everyone, but keeps showing the report for this visit.
  useEffect(() => {
    if (!current || !row || marked.current.has(current.program.id)) return;
    const pain = row.signals.find((s) => s.key === 'pain');
    if (!pain) return;
    marked.current.add(current.program.id);
    setPainSeen((cur) => ({ ...cur, [current.program.id]: pain.label }));
    void hepService.markPainReviewed(current.program.id).catch(() => { marked.current.delete(current.program.id); });
  }, [current, row]);

  async function act(fn: () => Promise<unknown>) {
    try { setError(null); await fn(); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'That did not work. Try again.'); }
  }

  if (!online && bundles === null) return <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">The home program needs a connection. Reconnect to see it.</p>;
  if (bundles === null) return <LoadingRows rows={4} label="Loading the home program" />;

  const active = bundles.filter((b) => b.program.status !== 'completed');
  const completed = bundles.filter((b) => b.program.status === 'completed');
  const prog = current?.program;
  const items = prog ? prog.items.filter((i) => i.removedOn == null) : [];
  const access = current?.access ?? null;
  const sharing = !!access && !access.linkRevoked;
  const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz }) : '');
  const strip = prog && current ? dayStrip(prog, prog.items, current.logs, today) : [];
  const timeline = prog && current ? dayTimeline(prog.items, current.logs, current.sessionFeedback, day, today) : [];
  const streak = prog && current ? currentStreak(prog, prog.items, current.logs, today) : 0;
  const trend = current ? trendSeries(current.sessionFeedback, today) : [];
  const sections = prog && current ? sectionAdherence({ items: prog.items, logs: current.logs, startDate: prog.startDate, today, durationDays: prog.durationDays }) : [];
  const minutes = items.length > 0 && prog ? estimateSessionMinutes(items.map(programItemToInput), prog.sessionsPerDay) : null;
  const attention = (row?.signals ?? []).filter((s) => s.attention || s.key === 'skip');
  const shareUrl = access ? buildHepWhatsAppShareUrl({ token: access.token, clinicName: clinic.name, phone: patient?.phone }) : '#';
  const dayLabel = day === today ? 'Today' : new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Programs">
        {active.map((b) => <button key={b.program.id} type="button" aria-pressed={b.program.id === shownId} className={filterChip(b.program.id === shownId)} onClick={() => { setShownId(b.program.id); setDay(today); }}>{b.program.title}{b.program.status === 'paused' ? ' (paused)' : ''}</button>)}
        {completed.length > 0 && (
          <select aria-label="Completed programs" className={`${inputCls} !w-auto`} value={completed.some((b) => b.program.id === shownId) ? (shownId ?? '') : ''} onChange={(e) => { if (e.target.value) { setShownId(e.target.value); setDay(today); } }}>
            <option value="">Completed ({completed.length})</option>
            {completed.map((b) => <option key={b.program.id} value={b.program.id}>{b.program.title} · {b.program.startDate}</option>)}
          </select>
        )}
        <div className="flex-1" />
        <Button type="button" className={pillSmPrimary} disabled={!online} onClick={() => setSheet({ mode: 'new' })}>+ New program</Button>
      </div>
      <ErrorNote message={error} />

      {!prog || !current || !row ? (
        <div className="space-y-2 rounded-2xl border border-dashed border-[var(--border)] p-6 text-center">
          <p className="font-display text-base font-semibold text-[var(--ink)]">No home program yet</p>
          <p className="mx-auto max-w-md text-sm text-[var(--muted)]">Give {patient?.name ?? 'this patient'} exercises to do at home: start from a template or pick from your Library.</p>
          <Button type="button" className={btnPrimary} disabled={!online} onClick={() => setSheet({ mode: 'new' })}>+ New program</Button>
        </div>
      ) : (
        <>
          <header className="space-y-2">
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-lg font-semibold text-[var(--ink)]">{prog.title} <span className="ml-1 rounded-full bg-[var(--paper)] px-2 py-0.5 align-middle text-xs font-medium text-[var(--muted)]">{prog.status === 'completed' ? 'Completed' : prog.status === 'paused' ? 'Paused' : row.ended ? 'Ended' : 'Active'}</span></h2>
                <p className="text-sm text-[var(--muted)]">{row.dayLabel} · {SESSION_LABEL[prog.sessionsPerDay]}{minutes != null && ` · about ${minutes} min a session`} · completed at {prog.targetPct}%{current.therapistName && ` · by ${current.therapistName}`}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {sharing && <a href={shareUrl} target="_blank" rel="noreferrer" className={`${pillSmPrimary} !min-h-9`}>Share link</a>}
                <Button type="button" className={pillSmAccent} disabled={!sharing} onClick={() => setMessaging(true)}>Message patient</Button>
                {prog.status !== 'completed' && <Button type="button" className={pillSmAccent} disabled={!online} onClick={() => setSheet({ mode: 'edit' })}>Edit program</Button>}
                <KebabMenu ariaLabel="More actions">
                  {(close) => (
                    <>
                      <button type="button" className={menuItem} onClick={() => { close(); setPrinting(true); }}>Print sheet</button>
                      <button type="button" className={menuItem} onClick={() => { close(); void act(() => hepService.duplicateProgram(prog.id)); }}>Duplicate</button>
                      <button type="button" className={menuItem} onClick={() => { close(); setTemplateName(prog.title); }}>Save as template</button>
                      {prog.durationDays != null && prog.status !== 'completed' && <button type="button" className={menuItem} onClick={() => { close(); setExtending(true); }}>Extend</button>}
                      {prog.status === 'active' && <button type="button" className={menuItem} onClick={() => { close(); void act(() => hepService.setProgramStatus(prog.id, 'paused')); }}>Pause</button>}
                      {prog.status === 'paused' && <button type="button" className={menuItem} onClick={() => { close(); void act(() => hepService.setProgramStatus(prog.id, 'active')); }}>Resume</button>}
                      {prog.status !== 'completed' && <button type="button" className={menuItem} onClick={() => { close(); setCompleting(true); }}>Mark completed</button>}
                      <button type="button" className={menuItem} onClick={() => { close(); setConfirmReset(true); }}>Reset PIN…</button>
                      {sharing
                        ? <button type="button" className={menuItemDestructive} onClick={() => { close(); setConfirmStop(true); }}>Stop sharing</button>
                        : <button type="button" className={menuItem} onClick={() => { close(); void act(() => hepService.rotateToken(patientId)); }}>Start sharing again</button>}
                    </>
                  )}
                </KebabMenu>
              </div>
            </div>
          </header>

          {(attention.length > 0 || painSeen[prog.id]) && (
            <section aria-label="Alerts" className="space-y-2 rounded-2xl border border-[var(--amber)] bg-[var(--amber-light)] p-4">
              <h3 className="font-display text-sm font-semibold text-[var(--amber-strong)]">Alerts</h3>
              <ul className="space-y-1.5 text-sm text-[var(--ink)]">
                {painSeen[prog.id] && <li><span className="font-medium text-[var(--rust)]">{painSeen[prog.id]}</span> <span className="text-[var(--muted)]">· Reviewed ✓ just now</span></li>}
                {attention.filter((s) => s.key !== 'pain').map((s) => (
                  <li key={s.key} className="flex flex-wrap items-center gap-2">
                    <span>{s.label}</span>
                    {(s.key === 'checkin' || s.key === 'idle' || s.key === 'link') && sharing && <Button type="button" className={pillSmNeutral} onClick={() => setMessaging(true)}>Message patient</Button>}
                    {s.key === 'ended' && (
                      <>
                        <Button type="button" className={pillSmNeutral} onClick={() => setExtending(true)}>Extend</Button>
                        <Button type="button" className={pillSmNeutral} onClick={() => setCompleting(true)}>Mark completed</Button>
                        <Button type="button" className={pillSmPrimary} onClick={() => setSheet({ mode: 'new' })}>Prescribe next</Button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-label="Progress" className="space-y-3">
            <h3 className="font-display text-sm font-semibold text-[var(--ink)]">Progress</h3>
            <div className="grid grid-cols-2 gap-2 desktop:grid-cols-5">
              <Tile label="Today" value={row.todayTarget > 0 ? `${row.todayCompleted} of ${row.todayTarget}` : '—'} sub="sessions" />
              <Tile label="Adherence" value={row.habitPercent == null ? 'Not enough data' : `${row.habitPercent}%`} sub={row.habitPercent == null ? undefined : `${row.finishedDays} ${row.finishedDays === 1 ? 'day' : 'days'} finished`} />
              <Tile label="Streak" value={`${streak} ${streak === 1 ? 'day' : 'days'}`} />
              <Tile label="Last active" value={row.lastActiveLabel} sub={access ? `Opened ${access.openCount}×` : undefined} />
              <Tile label="Pain · Effort" value={trend.some((t) => t.pain != null || t.effort != null) ? `${trend.filter((t) => t.pain != null).at(-1)?.pain ?? '–'} · ${trend.filter((t) => t.effort != null).at(-1)?.effort ?? '–'}` : '—'} sub="latest session" />
            </div>
            {trend.some((t) => t.pain != null || t.effort != null) && (
              <p className="text-xs text-[var(--muted)]" aria-label="Pain and effort, last 7 days">Last 7 days · Pain {trend.map((t) => t.pain ?? '–').join(' ')} · Effort {trend.map((t) => t.effort ?? '–').join(' ')}</p>
            )}

            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-[var(--ink)]">Last 14 days <span className="font-normal text-[var(--muted)]">· tap a day to see what was done</span></p>
              <div className="flex gap-1 overflow-x-auto pb-1" role="group" aria-label="Last 14 days">
                {strip.map((c) => {
                  const d = new Date(`${c.date}T00:00:00Z`);
                  return (
                    <button key={c.date} type="button" title={d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })} aria-label={`${c.date}: ${CELL_WORD[c.state]}`} aria-pressed={c.date === day} onClick={() => setDay(c.date)} className={`flex h-12 w-11 shrink-0 flex-col items-center justify-center rounded-lg text-xs font-medium leading-tight ${CELL_CLASS[c.state]} ${c.date === day ? 'ring-2 ring-[var(--ink)]' : ''}`}>
                      <span className="text-[10px] uppercase opacity-80">{d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}</span>
                      <span className="text-sm">{d.getUTCDate()}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-[var(--muted)]">Green: everything done · Amber: partly done · Red: missed · Grey: nothing due that day (before the program started or after it ended).</p>
            </div>

            <div className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <h4 className="text-sm font-semibold text-[var(--ink)]">{dayLabel}</h4>
              {timeline.length === 0 && <p className="text-sm text-[var(--muted)]">Nothing was due this day.</p>}
              {timeline.map((s) => (
                <div key={s.index} className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h5 className="text-sm font-medium text-[var(--ink)]">{s.label}</h5>
                    {s.pain != null && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.pain >= 7 ? 'bg-[var(--rust-light)] text-[var(--rust)]' : 'bg-[var(--paper)] text-[var(--muted)]'}`}>Pain {s.pain}/10</span>}
                    {s.effort != null && <span className="rounded-full bg-[var(--paper)] px-2 py-0.5 text-xs font-medium text-[var(--muted)]">Effort {s.effort}/10</span>}
                  </div>
                  {(s.hurt.length > 0 || s.hardest.length > 0) && <p className="text-xs text-[var(--muted)]">{s.hurt.length > 0 && <>Hurt: {s.hurt.join(', ')}. </>}{s.hardest.length > 0 && <>Hardest: {s.hardest.join(', ')}.</>}</p>}
                  <ul className="space-y-0.5 text-sm">
                    {s.entries.map((e) => (
                      <li key={e.itemId} className="flex flex-wrap items-center gap-x-2">
                        <span aria-hidden="true" className={e.status === 'done' ? 'text-[var(--teal)]' : e.status === 'skipped' ? 'text-[var(--amber-strong)]' : e.status === 'not_done' ? 'text-[var(--rust)]' : 'text-[var(--muted)]'}>{e.status === 'done' ? '✓' : e.status === 'skipped' ? '↷' : e.status === 'not_done' ? '✕' : '○'}</span>
                        <span className="text-[var(--ink)]">{e.title}{e.optional ? ' (optional)' : ''}</span>
                        <span className="text-xs text-[var(--muted)]">{e.status === 'done' ? `Done ${fmtTime(e.at)}` : e.status === 'skipped' ? `Skipped${e.reason ? `: ${SKIP_REASON_LABEL[e.reason]}` : ''}` : e.status === 'not_done' ? 'Not done' : 'To do'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>

          {sections.length > 1 && (
            <section aria-label="By section" className="space-y-1">
              <h3 className="font-display text-sm font-semibold text-[var(--ink)]">By section</h3>
              <p className="text-sm text-[var(--ink)]">{sections.map((s) => `${EXERCISE_PHASE_LABELS[s.phase]} ${s.percent == null ? '–' : `${s.percent}%`}`).join(' · ')}</p>
            </section>
          )}

          <section aria-label="By exercise" className="space-y-1.5">
            <h3 className="font-display text-sm font-semibold text-[var(--ink)]">By exercise</h3>
            <ul className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
              {itemsInSessionOrder(items).map((i) => (
                <li key={i.id} className="p-3">
                  <p className="text-sm font-medium text-[var(--ink)]">{i.title}{i.optional && <span className="ml-2 text-xs font-normal text-[var(--muted)]">Optional</span>}</p>
                  <p className="text-xs text-[var(--muted)]">{describeDose(itemDose(programItemToInput(i)), prog.sessionsPerDay)}</p>
                  <p className="text-xs text-[var(--muted)]">{itemProgressLine(itemProgress(i, prog, current.logs, current.sessionFeedback, today))}</p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-label="Patient link" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-[var(--paper)] p-3 text-sm">
            <span className="font-medium text-[var(--ink)]">Patient link</span>
            <span className="text-[var(--muted)]">{!access ? 'Not shared yet' : sharing ? `Sharing on · ${access.lastOpenedAt ? `last opened ${new Date(access.lastOpenedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: tz })}` : 'not opened yet'}` : 'Sharing stopped'}</span>
            {sharing && access && <Button type="button" className="text-xs font-medium text-[var(--teal)]" onClick={() => void navigator.clipboard.writeText(buildHepPortalUrl(access.token)).catch(() => setError('Could not copy. Select it and copy by hand.'))}>Copy link</Button>}
            <Button type="button" className="text-xs font-medium text-[var(--teal)]" disabled={!online} onClick={() => setConfirmReset(true)}>Reset PIN…</Button>
            {sharing && <Button type="button" className="text-xs font-medium text-[var(--rust)]" disabled={!online} onClick={() => setConfirmStop(true)}>Stop sharing</Button>}
          </section>
        </>
      )}

      <ProgramSheet
        open={sheet !== null}
        mode={sheet?.mode ?? 'new'}
        patientId={patientId}
        bundle={sheet?.mode === 'edit' ? (current ?? undefined) : undefined}
        startFrom={sheet?.mode === 'new' && current && row?.ended ? { program: current } : undefined}
        onClose={() => setSheet(null)}
        onSaved={() => void load()}
      />
      {messaging && access && <MessagePatientSheet open patientId={patientId} token={access.token} onClose={() => setMessaging(false)} />}
      {prog && access && <PrintSheet open={printing} onClose={() => setPrinting(false)} clinicName={clinic.name} patientName={patient?.name ?? ''} programTitle={prog.title} link={buildHepPortalUrl(access.token)} pin={null} items={items.map(programItemToInput)} />}
      {prog && access && handOver && <HandOverPanel open onClose={() => setHandOver(null)} patientId={patientId} patientName={patient?.name ?? ''} patientPhone={patient?.phone ?? null} programId={prog.id} programTitle={prog.title} token={access.token} pin={handOver.pin} items={items.map(programItemToInput)} fromTemplate />}

      <ConfirmDialog open={completing} title="Mark this program completed?" message="It moves to Completed and the patient's page stops showing it." confirmLabel="Mark completed" onConfirm={() => { setCompleting(false); if (prog) void act(() => hepService.setProgramStatus(prog.id, 'completed')); }} onCancel={() => setCompleting(false)} />
      <ConfirmDialog open={confirmReset} title="Reset the PIN?" message="The old PIN stops working and remembered phones will ask for the new one. You will see the new PIN once." confirmLabel="Reset PIN" onConfirm={() => { setConfirmReset(false); void act(async () => { const pin = await hepService.resetPin(patientId); setHandOver({ pin }); }); }} onCancel={() => setConfirmReset(false)} />
      <ConfirmDialog open={confirmStop} title="Stop sharing?" message="The patient's link stops working at once. You can start sharing again later with a new link." confirmLabel="Stop sharing" destructive onConfirm={() => { setConfirmStop(false); void act(() => hepService.revokeLink(patientId)); }} onCancel={() => setConfirmStop(false)} />
      <SheetDialog open={extending} title="Extend this program" onClose={() => setExtending(false)} footer={<Button type="button" className={btnSecondary} onClick={() => setExtending(false)}>Cancel</Button>}>
        <p className="mb-3 text-sm text-[var(--muted)]">Keep “{prog?.title}” going. Add:</p>
        <div className="flex flex-wrap gap-2">{EXTEND_DAYS.map((n) => <Button key={n} type="button" className={btnPrimary} onClick={() => { setExtending(false); if (prog) void act(() => hepService.extendProgram(prog.id, n)); }}>{n} days</Button>)}</div>
      </SheetDialog>
      <SheetDialog open={templateName !== null} title="Save as template" onClose={() => setTemplateName(null)} footer={<><Button type="button" className={btnSecondary} onClick={() => setTemplateName(null)}>Cancel</Button><Button type="button" className={btnPrimary} onClick={() => { const name = (templateName ?? '').trim(); setTemplateName(null); if (prog && name) void act(() => hepService.saveProgramAsTemplate(prog.id, name)); }}>Save</Button></>}>
        <label className="block text-sm text-[var(--ink)]">Template name (staff only)<input className={`${inputCls} mt-1`} value={templateName ?? ''} maxLength={80} onChange={(e) => setTemplateName(e.target.value)} /></label>
      </SheetDialog>
    </div>
  );
}
