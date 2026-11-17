// The patient chart's Home program tab, top to bottom: program chips (+ New program), the alert banners (a pain report
// with Call and Mark reviewed; check-in, ended and no-activity alerts with their actions), the program card (actions,
// sub line, day bar, patient link), the stats row, the last 14 days with the pain and effort trend beside the chosen day,
// By exercise, and the folded Earlier programs. Programs live on the server: this tab needs a connection.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useClinic } from '@/app/clinicContext';
import { Button } from '@/components/Button';
import { ConfirmDialog, ErrorNote, LoadingRows, SheetDialog, btnPrimary, btnSecondary, filterChip, inputCls, menuItem, menuItemDestructive, pillSmNeutral, pillSmPrimary } from '@/components/ui';
import { clinicCountryCode, clinicTimezone } from '@/domain/clinicRegion';
import { EXERCISE_PHASE_LABELS, addDaysISO, estimateSessionMinutes, sectionAdherence } from '@/domain/hep';
import { repos } from '@/services';
import { hepService, type ProgramBundle } from '@/services/hepService';
import type { Patient } from '@/domain/types';
import { ByExerciseTable } from './ByExerciseTable';
import { HandOverPanel } from './HandOverPanel';
import { programItemToInput } from './hepItems';
import { buildHepPortalUrl, buildHepWhatsAppShareUrl } from './hepSharing';
import { currentStreak, dayStrip, daySummary, dayTimeline, programDateRange, reviewLabel, trendSeries } from './homeProgram';
import { MessagePatientSheet } from './MessagePatientSheet';
import { PrintSheet } from './PrintSheet';
import { ProgramCard, programStatusKey, programStatusWord } from './ProgramCard';
import { ProgramDays } from './ProgramDays';
import { SESSION_LABEL } from './ProgramItemsEditor';
import { ProgramLinkLine } from './ProgramLinkLine';
import { ProgramSheet } from './ProgramSheet';
import { EXTEND_DAYS, buildProgramRow, telHref } from './programRows';
import { clinicToday, useOnline } from './useHepData';
import { notifyPainReviewed } from './useHomeProgramDot';

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
  const [earlierOpen, setEarlierOpen] = useState(false);

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

  // "Mark reviewed" marks the pain report seen for everyone (the Programs list stops flagging it) but keeps showing it
  // here for this visit, with "Reviewed ✓ just now".
  function markReviewed(programId: string, label: string) {
    setPainSeen((cur) => ({ ...cur, [programId]: label }));
    void hepService.markPainReviewed(programId).then(() => notifyPainReviewed(patientId), (e: unknown) => {
      setPainSeen((cur) => { const next = { ...cur }; delete next[programId]; return next; });
      setError(e instanceof Error ? e.message : 'Could not mark it reviewed. Try again.');
    });
  }

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
  const yesterday = prog && current ? daySummary(dayTimeline(prog.items, current.logs, current.sessionFeedback, addDaysISO(today, -1), today)) : null;
  const streak = prog && current ? currentStreak(prog, prog.items, current.logs, today) : 0;
  const trend = current ? trendSeries(current.sessionFeedback, today) : [];
  const sections = prog && current ? sectionAdherence({ items: prog.items, logs: current.logs, startDate: prog.startDate, today, durationDays: prog.durationDays }) : [];
  const minutes = items.length > 0 && prog ? estimateSessionMinutes(items.map(programItemToInput), prog.sessionsPerDay) : null;
  const pain = row?.signals.find((s) => s.key === 'pain') ?? null;
  const attention = (row?.signals ?? []).filter((s) => s.attention || s.key === 'skip');
  const tel = telHref(patient?.phone, clinicCountryCode(clinic));
  const shareUrl = access ? buildHepWhatsAppShareUrl({ token: access.token, clinicName: clinic.name, phone: patient?.phone }) : '#';
  const review = prog && prog.status !== 'completed' ? reviewLabel(prog.checkinOn, today) : null;
  const subLine = prog
    ? [SESSION_LABEL[prog.sessionsPerDay], `${items.length} ${items.length === 1 ? 'exercise' : 'exercises'}`, minutes != null && `about ${minutes} min`, `completion target ${prog.targetPct}%`, current?.therapistName && `prescribed by ${current.therapistName}`, review].filter(Boolean).join(' · ')
    : '';
  const earlier = completed.map((b) => ({ id: b.program.id, title: b.program.title, range: programDateRange(b.program.startDate, b.program.durationDays), percent: buildProgramRow(b, { today, windowStart: addDaysISO(today, -WINDOW_DAYS) }).habitPercent }));
  // Chips use the card's status word; a rust dot marks another program with a pain report nobody has reviewed yet.
  const chips = active.map((b) => {
    const r = b.program.id === shownId && row ? row : buildProgramRow(b, { today, windowStart: addDaysISO(today, -WINDOW_DAYS) });
    return { id: b.program.id, title: b.program.title, word: programStatusWord(programStatusKey(r)), pain: b.program.id !== shownId && !painSeen[b.program.id] && r.signals.some((s) => s.key === 'pain') };
  });
  const show = (id: string) => { setShownId(id); setDay(today); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Programs">
        {chips.map((c) => (
          <button key={c.id} type="button" aria-pressed={c.id === shownId} className={filterChip(c.id === shownId)} onClick={() => show(c.id)}>
            {c.title} · {c.word}
            {c.pain && <><span aria-hidden="true" className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[var(--rust)] align-middle" /><span className="sr-only">, pain report waiting</span></>}
          </button>
        ))}
        {completed.length > 0 && <button type="button" aria-pressed={completed.some((b) => b.program.id === shownId)} aria-controls="hep-earlier" className={filterChip(completed.some((b) => b.program.id === shownId))} onClick={() => { setEarlierOpen(true); requestAnimationFrame(() => document.getElementById('hep-earlier')?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })); }}>Earlier ({completed.length})</button>}
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
          {(attention.length > 0 || pain || painSeen[prog.id]) && (
            <section aria-label="Alerts" className="space-y-2">
              {(pain || painSeen[prog.id]) && (
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl bg-[var(--rust-light)] px-3.5 py-2.5 text-sm text-[var(--rust)]">
                  <span><span className="font-semibold">{painSeen[prog.id] ?? pain?.label}</span>{painSeen[prog.id] && <span className="text-[var(--muted)]"> · Reviewed ✓ just now</span>}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {tel && <a href={tel} className={`${pillSmNeutral} inline-flex items-center`}>Call</a>}
                    {!painSeen[prog.id] && <Button type="button" className={pillSmNeutral} disabled={!online} onClick={() => markReviewed(prog.id, pain?.label ?? '')}>Mark reviewed</Button>}
                  </span>
                </div>
              )}
              {attention.filter((s) => s.key !== 'pain').map((s) => (
                <div key={s.key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl bg-[var(--amber-light)] px-3.5 py-2.5 text-sm text-[var(--amber-strong)]">
                  <span className="font-medium">{s.label}</span>
                  <span className="flex flex-wrap gap-1.5">
                    {(s.key === 'checkin' || s.key === 'idle' || s.key === 'link') && sharing && <Button type="button" className={pillSmNeutral} onClick={() => setMessaging(true)}>Message patient</Button>}
                    {s.key === 'ended' && (
                      <>
                        <Button type="button" className={pillSmNeutral} onClick={() => setExtending(true)}>Extend</Button>
                        <Button type="button" className={pillSmNeutral} onClick={() => setCompleting(true)}>Mark completed</Button>
                        <Button type="button" className={pillSmPrimary} onClick={() => setSheet({ mode: 'new' })}>Prescribe next</Button>
                      </>
                    )}
                  </span>
                </div>
              ))}
            </section>
          )}

          <ProgramCard
            program={prog}
            row={row}
            today={today}
            subLine={subLine}
            online={online}
            canMessage={sharing}
            onEdit={() => setSheet({ mode: 'edit' })}
            onMessage={() => setMessaging(true)}
            menu={(close) => (
              <>
                <button type="button" className={menuItem} onClick={() => { close(); setPrinting(true); }}>Print sheet</button>
                <button type="button" className={menuItem} onClick={() => { close(); void act(() => hepService.duplicateProgram(prog.id)); }}>Duplicate</button>
                <button type="button" className={menuItem} onClick={() => { close(); setTemplateName(prog.title); }}>Save as template</button>
                {prog.durationDays != null && prog.status !== 'completed' && <button type="button" className={menuItem} onClick={() => { close(); setExtending(true); }}>Extend</button>}
                {prog.status === 'active' && <button type="button" className={menuItem} onClick={() => { close(); void act(() => hepService.setProgramStatus(prog.id, 'paused')); }}>Pause</button>}
                {prog.status === 'paused' && <button type="button" className={menuItem} onClick={() => { close(); void act(() => hepService.setProgramStatus(prog.id, 'active')); }}>Resume</button>}
                {prog.status !== 'completed' && <button type="button" className={menuItem} onClick={() => { close(); setCompleting(true); }}>Mark completed</button>}
                {(prog.status === 'completed' || row.ended) && <button type="button" className={menuItem} onClick={() => { close(); setSheet({ mode: 'new' }); }}>Prescribe next</button>}
                <button type="button" className={menuItem} onClick={() => { close(); setConfirmReset(true); }}>Reset PIN…</button>
                {sharing
                  ? <button type="button" className={menuItemDestructive} onClick={() => { close(); setConfirmStop(true); }}>Stop sharing</button>
                  : <button type="button" className={menuItem} onClick={() => { close(); void act(() => hepService.rotateToken(patientId)); }}>Start sharing again</button>}
              </>
            )}
            linkLine={(
              <ProgramLinkLine
                access={access}
                today={today}
                timeZone={tz}
                online={online}
                whatsAppUrl={shareUrl}
                onCopy={() => { if (access) void navigator.clipboard.writeText(buildHepPortalUrl(access.token)).catch(() => setError('Could not copy. Select it and copy by hand.')); }}
                onResetPin={() => setConfirmReset(true)}
                onStop={() => setConfirmStop(true)}
              />
            )}
          />

          <section aria-label="Progress" className="grid grid-cols-2 gap-2 tab:grid-cols-3 desktop:grid-cols-5">
            <Tile label="Today" value={row.todayTarget > 0 ? `${row.todayCompleted} of ${row.todayTarget}` : '—'} sub="sessions" />
            <Tile label="Adherence" value={row.habitPercent == null ? 'Not enough data' : `${row.habitPercent}%`} sub={row.habitPercent == null ? undefined : `${row.finishedDays} ${row.finishedDays === 1 ? 'day' : 'days'} finished`} />
            <Tile label="Streak" value={`${streak} ${streak === 1 ? 'day' : 'days'}`} />
            <Tile label="Last active" value={row.lastActiveLabel} sub={access ? `Opened ${access.openCount}×` : undefined} />
            <Tile label="Pain · effort" value={trend.some((t) => t.pain != null || t.effort != null) ? `${trend.filter((t) => t.pain != null).at(-1)?.pain ?? '–'} · ${trend.filter((t) => t.effort != null).at(-1)?.effort ?? '–'}` : '—'} sub="latest session" />
          </section>

          <ProgramDays
            strip={strip}
            day={day}
            today={today}
            onDay={setDay}
            timeline={timeline}
            yesterday={yesterday}
            todayCount={row.todayTarget > 0 ? `${row.todayCompleted} of ${row.todayTarget} sessions` : null}
            trend={trend}
            fmtTime={fmtTime}
          />

          <ByExerciseTable items={items} program={prog} logs={current.logs} feedback={current.sessionFeedback} today={today}>
            {sections.length > 1 && (
              <section aria-label="By section">
                <p className="text-xs text-[var(--muted)]">{sections.map((s) => `${EXERCISE_PHASE_LABELS[s.phase]} ${s.percent == null ? '–' : `${s.percent}%`}`).join(' · ')}</p>
              </section>
            )}
          </ByExerciseTable>
        </>
      )}

      {completed.length > 0 && (
        <section id="hep-earlier" aria-label="Earlier programs" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <button type="button" aria-expanded={earlierOpen} className="flex w-full items-center justify-between p-3 text-left text-sm font-semibold text-[var(--ink)]" onClick={() => setEarlierOpen((o) => !o)}>
            Earlier programs ({completed.length})<span aria-hidden="true" className="text-[var(--muted)]">{earlierOpen ? '▴' : '▾'}</span>
          </button>
          {earlierOpen && (
            <ul className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
              {earlier.map((e) => (
                <li key={e.id}>
                  <button type="button" aria-pressed={e.id === shownId} className="flex w-full flex-wrap items-baseline justify-between gap-x-3 p-3 text-left text-sm hover:bg-[var(--paper)]" onClick={() => show(e.id)}>
                    <span className="font-medium text-[var(--ink)]">{e.title} <span className="font-normal text-[var(--muted)]">· {e.range}</span></span>
                    <span className="text-xs text-[var(--muted)]">{e.percent == null ? 'Not enough data' : `${e.percent}%`} · completed</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
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
