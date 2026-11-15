// The patient's Home tab: the greeting, Today's program with a Start / Continue button, this week, the next clinic visit,
// the open package, other and earlier programs, Book a visit and Call clinic. Everything except Today comes from the
// Home RPC (`home`); when that call failed or is still loading, only the Today card shows. Cards with nothing to say
// are left out, never shown empty.
import { addDaysISO } from '@/domain/hep';
import { formatAppointmentWhen } from '@/domain/appointmentWhen';
import { formatDateDMY } from '@/domain/fiscalYear';
import type { PublicHepHome } from '@/services/publicHepService';
import type { HepData } from './HepExercises';
import { dayNumber, itemsDueOn, sessionsToday, timesADay, todayCounts, weekStrip, type PublicLog, type WeekDayState } from './hepSession';

export type HepHomeData = Omit<PublicHepHome, 'ok'>;
type Program = HepData['programs'][number];

export interface HepHomeProps {
  data: HepData;
  program: Program;
  logs: PublicLog[];
  today: string;
  /** The Home RPC's answer; null while loading, when it failed, or in the therapist's preview. */
  home: HepHomeData | null;
  onStart: () => void;
  onOpenProgram: (programId: string) => void;
}

const card = 'space-y-2 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm';
const cardTitle = 'text-sm font-bold uppercase tracking-wide text-slate-500';
const bigButton = 'flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-base font-semibold text-slate-900';

const DAY_WORDS: Record<WeekDayState, string> = { done: 'done', partly: 'partly done', missed: 'missed', open: 'to do', not_due: 'not due' };
const DAY_COLOURS: Record<WeekDayState, string> = {
  done: 'bg-teal-600',
  partly: 'bg-teal-200',
  missed: 'bg-rose-100',
  open: 'bg-white',
  not_due: 'bg-slate-100',
};

function Bar({ fraction, label }: { fraction: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="h-2.5 overflow-hidden rounded-full bg-slate-200">
      <div className="h-full rounded-full bg-teal-600" style={{ width: `${pct}%` }} />
    </div>
  );
}

const endOf = (p: { startDate: string; durationDays: number | null }) => (p.durationDays ? addDaysISO(p.startDate, p.durationDays - 1) : null);

export function HepHome({ data, program, logs, today, home, onStart, onOpenProgram }: HepHomeProps) {
  const counts = todayCounts(data.items, logs, today);
  const started = logs.some((l) => l.logDate === today);
  const day = dayNumber(program.startDate, today);
  const dueCount = itemsDueOn(data.items, today).length;
  const fromLine = [program.prescribedBy ? `From ${program.prescribedBy}` : null, `${dueCount} ${dueCount === 1 ? 'exercise' : 'exercises'}`, timesADay(sessionsToday(data.items, today))]
    .filter(Boolean)
    .join(' · ');
  const phone = data.clinic.phone;

  const others = home?.programs.filter((p) => p.status === 'active' && p.id !== program.id) ?? [];
  const earlier = home?.programs.filter((p) => p.status !== 'active') ?? [];
  const visit = home?.nextVisit ?? null;
  const pack = home?.package ?? null;
  const where = visit ? (visit.location === 'home' ? 'Home visit' : visit.location === 'ward' ? 'Ward visit' : data.clinic.name) : '';

  return (
    <div className="space-y-4">
      {home?.firstName && (
        <div>
          <p className="text-2xl font-bold">Hi {home.firstName}</p>
          <p className="text-base text-slate-600">Here is where things stand.</p>
        </div>
      )}

      <section aria-labelledby="hep-home-today" className="space-y-2 rounded-2xl border-2 border-teal-600 bg-teal-50 p-4 shadow-sm">
        <p id="hep-home-today" className="text-sm font-bold uppercase tracking-wide text-teal-800">Today</p>
        <h2 className="text-xl font-bold leading-tight">{program.title}</h2>
        <p className="text-base text-slate-600">{fromLine}</p>
        <div className="flex items-center justify-between text-base text-slate-700">
          <span>{program.durationDays ? `Day ${Math.min(day, program.durationDays)} of ${program.durationDays}` : `Day ${day}`}</span>
          {counts.total > 0 && <span>{counts.done} of {counts.total} done</span>}
        </div>
        {counts.total > 0 && <Bar fraction={counts.done / counts.total} label="Done today" />}
        <button type="button" onClick={onStart} className="mt-1 min-h-12 w-full rounded-xl bg-teal-700 px-6 text-lg font-bold text-white">
          {started ? 'Continue my exercises' : 'Start my exercises'}
        </button>
      </section>

      {home && (
        <section aria-labelledby="hep-home-week" className={card}>
          <p id="hep-home-week" className={cardTitle}>This week</p>
          <div className="flex gap-1.5">
            {weekStrip(data.items, logs, today, program).map((d) => (
              <div key={d.date} className="flex-1 text-center">
                <div
                  role="img"
                  aria-label={`${d.label}: ${DAY_WORDS[d.state]}${d.isToday ? ', today' : ''}`}
                  className={`h-8 rounded-lg ${DAY_COLOURS[d.state]} ${d.isToday ? 'ring-2 ring-teal-700' : d.state === 'open' ? 'border border-slate-300' : ''}`}
                />
                <span aria-hidden className="text-sm text-slate-500">{d.label.charAt(0)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {visit && (
        <section aria-labelledby="hep-home-visit" className={card}>
          <p id="hep-home-visit" className={cardTitle}>Next visit</p>
          <p className="text-lg font-bold">{formatAppointmentWhen(visit.at, data.clinic.timezone)}</p>
          <p className="text-base text-slate-600">{visit.therapistName ? `With ${visit.therapistName} · ${where}` : where}</p>
        </section>
      )}

      {pack && pack.total > 0 && (
        <section aria-labelledby="hep-home-package" className={card}>
          <p id="hep-home-package" className={cardTitle}>Your package</p>
          <div className="flex items-center justify-between gap-2">
            <span className="text-base font-bold">{pack.name ?? 'Sessions'}</span>
            <span className="rounded-full bg-sky-50 px-3 py-0.5 text-base font-semibold text-sky-800">{Math.max(0, pack.total - pack.done)} of {pack.total} left</span>
          </div>
          <Bar fraction={pack.done / pack.total} label="Sessions used" />
          {pack.expiresOn && <p className="text-base text-slate-600">Valid until {formatDateDMY(pack.expiresOn)}</p>}
        </section>
      )}

      {(others.length > 0 || earlier.length > 0) && (
        <section aria-label={others.length > 0 ? 'Other programs' : 'Earlier programs'} className={card}>
          {others.length > 0 && <p aria-hidden className={cardTitle}>Other programs</p>}
          {others.map((p) => {
            const d = dayNumber(p.startDate, today);
            return (
              <div key={p.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold">{p.title}</p>
                  <p className="text-sm text-slate-600">
                    Also active · {p.durationDays ? `Day ${Math.min(d, p.durationDays)} of ${p.durationDays}` : `Day ${d}`} · {p.itemCount} {p.itemCount === 1 ? 'exercise' : 'exercises'}
                  </p>
                </div>
                <button type="button" onClick={() => onOpenProgram(p.id)} aria-label={`Open ${p.title}`} className="min-h-11 rounded-xl border border-slate-300 px-4 text-base font-semibold">Open</button>
              </div>
            );
          })}
          {earlier.length > 0 && (
            <details className={others.length > 0 ? 'border-t border-slate-100 pt-2' : ''}>
              <summary className="min-h-11 cursor-pointer py-2 text-base font-semibold">Earlier programs ({earlier.length})</summary>
              <ul className="space-y-1 text-base text-slate-600">
                {earlier.map((p) => {
                  const end = endOf(p);
                  return <li key={p.id}>{p.title} · {end ? `${formatDateDMY(p.startDate)} to ${formatDateDMY(end)}` : `from ${formatDateDMY(p.startDate)}`}</li>;
                })}
              </ul>
            </details>
          )}
        </section>
      )}

      {home && (home.bookingSlug || phone) && (
        <div className="flex gap-2">
          {home.bookingSlug && <a href={`/book/${encodeURIComponent(home.bookingSlug)}`} className={bigButton}><span aria-hidden>📅</span> Book a visit</a>}
          {phone && <a href={`tel:${phone.replace(/\s+/g, '')}`} className={bigButton}><span aria-hidden>📞</span> Call clinic</a>}
        </div>
      )}
    </div>
  );
}
