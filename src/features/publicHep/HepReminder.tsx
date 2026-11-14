// "Add a daily reminder to my calendar": a time for each session, then a .ics file the phone's calendar offers to add.
// Some in-app browsers block files, so the page says what to do if nothing happens.
import { useState } from 'react';
import { buildHepReminderIcs } from './hepCalendar';
import { sessionLabel } from './hepSession';

const CHIPS = [
  { label: '8 am', value: '08:00' },
  { label: '1 pm', value: '13:00' },
  { label: '6 pm', value: '18:00' },
];

const defaultTimes = (count: number): string[] => (count <= 1 ? ['08:00'] : count === 2 ? ['08:00', '18:00'] : ['08:00', '13:00', '18:00']);

export interface HepReminderProps {
  clinicName: string;
  url: string;
  sessionCount: number;
  startDate: string;
  endDate: string | null;
  onClose: () => void;
}

export function HepReminder({ clinicName, url, sessionCount, startDate, endDate, onClose }: HepReminderProps) {
  const [times, setTimes] = useState<string[]>(() => defaultTimes(sessionCount));
  const [tried, setTried] = useState(false);

  function add() {
    try {
      const ics = buildHepReminderIcs({ clinicName, url, times: times.filter(Boolean), startDate, endDate });
      const blobUrl = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = 'exercise-reminder.ics';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);
    } catch {
      /* the hint below still tells the patient what to do */
    }
    setTried(true);
  }

  return (
    <section aria-label="Daily reminder" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-bold">Add a daily reminder to my calendar</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 text-xl text-slate-600">✕</button>
      </div>
      {times.map((time, i) => {
        const label = sessionLabel(sessionCount, i + 1) || 'Time';
        return (
          <div key={i} className="space-y-1">
            <p className="text-base font-semibold">{label}</p>
            <div className="flex flex-wrap items-center gap-2">
              {CHIPS.map((c) => (
                <button key={c.value} type="button" aria-pressed={time === c.value} onClick={() => setTimes((cur) => cur.map((t, j) => (j === i ? c.value : t)))} className={`min-h-11 rounded-full border px-4 text-base ${time === c.value ? 'border-teal-700 bg-teal-50 font-semibold text-teal-900' : 'border-slate-300'}`}>{c.label}</button>
              ))}
              <input type="time" aria-label={`${label} time`} value={time} onChange={(e) => setTimes((cur) => cur.map((t, j) => (j === i ? e.target.value : t)))} className="min-h-11 rounded-xl border border-slate-300 px-3 text-base" />
            </div>
          </div>
        );
      })}
      <button type="button" onClick={add} disabled={times.every((t) => !t)} className="min-h-12 w-full rounded-full bg-teal-700 px-5 text-base font-semibold text-white disabled:opacity-50">Add to my calendar</button>
      {tried && <p className="text-base text-slate-600">If nothing happened, open this page in your phone&apos;s browser to add the reminder.</p>}
    </section>
  );
}
