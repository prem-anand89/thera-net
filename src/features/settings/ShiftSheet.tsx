import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { bookingService, repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { ConfirmDialog, Segmented, SheetDialog, btnPrimary, btnSecondary } from '@/components/ui';
import { WorkingHoursEditor, defaultWorkingHours } from '@/components/schedule/WorkingHoursEditor';
import { appointmentsOutsideHours } from '@/features/schedule/hoursConflicts';
import { toLocalDateStr, workingHoursProblem } from '@/domain/schedule';
import { toFriendlyMessage } from '@/lib/errors';
import type { Appointment, Clinic, ShiftTemplate, Therapist, TherapistShiftAssignment, WorkingHours } from '@/domain/types';
import {
  WEEKDAY_META,
  WEEKDAY_ORDER,
  describeSchedule,
  formatBreakDuration,
  formatRange12h,
  formatWeekdays,
  hoursAfterShiftAssign,
  minutesToTimeInput,
  sortWeekdays,
  timeInputToMinutes,
} from './shiftUtils';

export type ShiftKind = 'shift' | 'own' | 'clinic';

const KIND_LABEL: Record<ShiftKind, string> = { shift: 'Shift type', own: 'Own hours', clinic: 'Clinic hours' };

/**
 * One sheet for setting a therapist's hours (Team → Shifts and the Team member card), or for assigning one shift
 * type to several people at once (`therapistId` null). Three ways to set hours: a **Shift type** on chosen days,
 * **Own hours** (day by day, one person only) or **Clinic hours**. Before saving it counts upcoming appointments that
 * would fall outside the new hours and asks "Save anyway"; it never blocks. Loads its own data.
 */
export function ShiftSheet({
  open,
  onClose,
  therapistId,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  /** The person being edited; null opens "Assign a shift" with a people picker. */
  therapistId: string | null;
  onSaved?: () => void;
}) {
  const clinic = useClinic();
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinic.id, true), [clinic.id]);
  const assignments = useLiveQuery(() => repos.therapistShiftAssignments.listByClinic(clinic.id), [clinic.id]);
  const appointments = useLiveQuery(() => repos.appointments.listByClinic(clinic.id), [clinic.id]);

  if (!open) return null;
  if (!therapists || !templates || !assignments) {
    return (
      <SheetDialog open title="Working hours" onClose={onClose} footer={null}>
        <p className="text-sm text-[var(--muted)]">Loading…</p>
      </SheetDialog>
    );
  }
  return (
    <ShiftSheetForm
      key={therapistId ?? 'bulk'}
      clinic={clinic}
      therapistId={therapistId}
      therapists={therapists}
      templates={templates}
      approved={assignments.filter((a) => a.status === 'approved')}
      appointments={appointments ?? []}
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}

function clinicHoursOf(clinic: Clinic) {
  return {
    startHour: clinic.bookingStartHour ?? 9,
    endHour: clinic.bookingEndHour ?? 17,
    operating: clinic.operatingHours ?? null,
    closedWeekdays: clinic.closedWeekdays ?? [],
  };
}

function ShiftSheetForm({
  clinic,
  therapistId,
  therapists,
  templates,
  approved,
  appointments,
  onClose,
  onSaved,
}: {
  clinic: Clinic;
  therapistId: string | null;
  therapists: Therapist[];
  templates: ShiftTemplate[];
  approved: TherapistShiftAssignment[];
  appointments: Appointment[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const bulk = therapistId === null;
  // Any roster row, active or not: an inactive therapist's card can still set their hours. The picker lists active only.
  const person = bulk ? null : therapists.find((t) => t.id === therapistId) ?? null;
  const pickable = therapists.filter((t) => t.active !== false);
  const activeTemplates = useMemo(() => templates.filter((t) => t.active), [templates]);
  const clinicHours = useMemo(() => clinicHoursOf(clinic), [clinic]);
  const closedDays = clinicHours.closedWeekdays;
  const openDays = WEEKDAY_ORDER.filter((d) => !closedDays.includes(d));

  // What this person is on now.
  const myRows = useMemo(
    () => (person ? approved.filter((a) => a.therapistId === person.id && a.shiftTemplateId) : []),
    [approved, person]
  );
  const rowsOf = (id: string | null) => myRows.filter((a) => a.shiftTemplateId === id);
  const daysOf = (rows: TherapistShiftAssignment[]) => sortWeekdays(Array.from(new Set(rows.flatMap((a) => a.weekdays ?? []))));
  const firstActiveRow = myRows.find((a) => activeTemplates.some((t) => t.id === a.shiftTemplateId)) ?? null;
  // The type the sheet opens on. A person on a hidden type starts on that type's rows, with nothing picked yet.
  const startTypeId = firstActiveRow?.shiftTemplateId ?? myRows[0]?.shiftTemplateId ?? null;
  const onHiddenType = myRows.length > 0 && !firstActiveRow;
  const hiddenTypeName = onHiddenType ? templates.find((t) => t.id === startTypeId)?.name ?? null : null;
  const initialKind: ShiftKind = person
    ? myRows.length > 0
      ? activeTemplates.length > 0
        ? 'shift'
        : 'own'
      : person.workingHours
        ? 'own'
        : 'clinic'
    : activeTemplates.length > 0
      ? 'shift'
      : 'clinic';
  const initialTemplateId = firstActiveRow?.shiftTemplateId ?? (onHiddenType ? '' : activeTemplates[0]?.id ?? '');
  const startDays = startTypeId ? daysOf(rowsOf(startTypeId)) : sortWeekdays([...openDays]);
  const initialBreak = firstActiveRow?.breakStartMinute ?? null;
  const initialOwn = useMemo<WorkingHours>(
    () => (person?.workingHours ? person.workingHours : defaultWorkingHours(clinicHours)),
    [person, clinicHours]
  );

  const [people, setPeople] = useState<string[]>(person ? [person.id] : []);
  const [kind, setKind] = useState<ShiftKind>(initialKind);
  const [templateId, setTemplateId] = useState(initialTemplateId);
  const [days, setDays] = useState<number[]>(startDays);
  const [breakTime, setBreakTime] = useState<string>(initialBreak !== null ? minutesToTimeInput(initialBreak) : '');
  const [breakOpen, setBreakOpen] = useState(initialBreak !== null);
  const [own, setOwn] = useState<WorkingHours>(initialOwn);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outside, setOutside] = useState<number | null>(null);

  const template = activeTemplates.find((t) => t.id === templateId) ?? null;
  const kinds: ShiftKind[] = [
    ...(activeTemplates.length > 0 ? (['shift'] as const) : []),
    ...(bulk ? [] : (['own'] as const)),
    'clinic',
  ];

  // Lunch time override (only for a type with a break).
  const breakStart = template && breakOpen && breakTime ? timeInputToMinutes(breakTime) : null;
  const breakProblem =
    template && breakStart !== null
      ? breakStart < template.startMinute || breakStart + template.breakDurationMinutes > template.endMinute
        ? `Lunch must fit inside ${formatRange12h(template.startMinute, template.endMinute)}.`
        : null
      : null;

  const ownProblem = kind === 'own' ? workingHoursProblem(own) : null;

  // The rows this save replaces: the picked type's own rows, or (switching to a new type) the rows the sheet opened on.
  const heldRows = rowsOf(templateId);
  const replacedRows = bulk ? [] : heldRows.length > 0 ? heldRows : rowsOf(startTypeId);
  const baselineDays = heldRows.length > 0 ? daysOf(heldRows) : startDays;
  const baselineBreak = heldRows[0]?.breakStartMinute ?? null;

  const changed =
    bulk ||
    kind !== initialKind ||
    (kind === 'shift' && (heldRows.length === 0 || days.join() !== baselineDays.join() || (breakStart ?? null) !== baselineBreak)) ||
    (kind === 'own' && JSON.stringify(own) !== JSON.stringify(initialOwn));

  const canSave =
    !saving &&
    changed &&
    people.length > 0 &&
    (kind !== 'shift' || (template !== null && days.length > 0 && !breakProblem)) &&
    (kind !== 'own' || !ownProblem);

  const comparing = Boolean(person && startTypeId && kind === 'shift');
  const added = comparing ? days.filter((d) => !baselineDays.includes(d)) : [];
  const removed = comparing ? baselineDays.filter((d) => !days.includes(d)) : [];

  function hoursFor(id: string): WorkingHours | null {
    if (kind === 'clinic') return null;
    if (kind === 'own') return own;
    return hoursAfterShiftAssign({
      therapistId: id,
      approved,
      templates,
      template: template!,
      weekdays: days,
      breakStartMinute: breakStart,
      replacesIds: replacedRows.map((a) => a.id),
    });
  }

  function countOutside(): number {
    const todayIso = toLocalDateStr(new Date());
    return people.reduce(
      (sum, id) =>
        sum +
        appointmentsOutsideHours({
          appointments,
          therapistId: id,
          hours: hoursFor(id),
          clinicHours,
          slotMinutes: clinic.slotDurationMinutes || 30,
          todayIso,
        }).length,
      0
    );
  }

  async function save(confirmed = false) {
    if (!canSave) return;
    if (!confirmed) {
      const n = countOutside();
      if (n > 0) return setOutside(n);
    }
    setSaving(true);
    setError(null);
    const failed: string[] = [];
    let lastError = '';
    for (const id of people) {
      try {
        if (kind === 'clinic') await bookingService.assignCustomHours(id, null);
        else if (kind === 'own') await bookingService.assignCustomHours(id, own);
        else {
          // One call per replaced row (the RPC takes one id): each supersedes its row and drops the previous call's
          // row, because the days overlap, so exactly one row is left. Usually there is just one.
          const replaces: (string | null)[] = replacedRows.length > 0 ? replacedRows.map((a) => a.id) : [null];
          for (const replacesId of replaces) {
            await bookingService.assignShift({ therapistId: id, shiftTemplateId: template!.id, weekdays: days, breakStartMinute: breakStart, replacesId });
          }
        }
      } catch (e) {
        failed.push(id);
        lastError = toFriendlyMessage(e);
      }
    }
    setSaving(false);
    if (failed.length === 0) {
      onSaved?.();
      onClose();
      return;
    }
    setPeople(failed);
    setError(failed.length === 1 ? `Not saved: ${lastError}` : `Not saved for ${failed.length} people. Try again.`);
  }

  const toggleDay = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : sortWeekdays([...cur, d])));
  const togglePerson = (id: string) => setPeople((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const title = person ? `Working hours · ${person.name}` : 'Assign a shift';
  const saveLabel = saving ? 'Saving…' : bulk ? (people.length > 1 ? `Assign to ${people.length} people` : 'Assign') : 'Save';
  const clinicSummary = describeSchedule({ workingHours: null }, [], [], clinic).summary;
  const otherTypes = person
    ? Array.from(new Set(myRows.map((a) => a.shiftTemplateId))).filter((id) => id && !replacedRows.some((a) => a.shiftTemplateId === id))
    : [];

  return (
    <>
      <SheetDialog
        open
        title={title}
        onClose={onClose}
        busy={saving}
        error={error}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" className={btnSecondary} disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} disabled={!canSave} onClick={() => void save()}>
              {saveLabel}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          {person ? (
            <CurrentWeek therapist={person} approved={approved} templates={templates} clinic={clinic} />
          ) : (
            <fieldset>
              <legend className="mb-1.5 text-label font-medium text-[var(--muted)]">Who</legend>
              <div className="flex flex-wrap gap-1.5">
                {pickable.map((t) => {
                  const on = people.includes(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => togglePerson(t.id)}
                      className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 text-sm ${
                        on
                          ? 'border-[var(--teal)] bg-[var(--teal-light)] font-semibold text-[var(--teal-strong)]'
                          : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]'
                      }`}
                    >
                      <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: t.color ?? 'var(--teal)' }} />
                      {t.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {kinds.length > 1 && (
            <Segmented
              label="How hours are set"
              options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              value={kind}
              onChange={setKind}
            />
          )}

          {kind === 'shift' && (
            <div className="space-y-4">
              <fieldset>
                <legend className="mb-1.5 text-label font-medium text-[var(--muted)]">Shift type</legend>
                {hiddenTypeName && !template && (
                  <p className="mb-2 rounded-lg bg-[var(--amber-light)] px-3 py-2 text-xs text-[var(--ink)]" data-testid="hidden-type-note">
                    On {hiddenTypeName}, which is hidden. Pick a shift type to move them, or show it again under Shift types.
                  </p>
                )}
                <div className="overflow-hidden rounded-xl border border-[var(--border)]">
                  {activeTemplates.map((t) => (
                    <label
                      key={t.id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 border-t border-[var(--border)] px-3 py-2 first:border-t-0 has-[:checked]:bg-[var(--teal-light)]"
                    >
                      <input
                        type="radio"
                        name="shift-type"
                        className="h-4 w-4 accent-[var(--teal)]"
                        checked={templateId === t.id}
                        onChange={() => {
                          setTemplateId(t.id);
                          // A type this person is already on opens on its own days and lunch.
                          const held = rowsOf(t.id);
                          if (held.length > 0) setDays(daysOf(held));
                          const heldBreak = held[0]?.breakStartMinute ?? null;
                          setBreakOpen(heldBreak !== null);
                          setBreakTime(heldBreak !== null ? minutesToTimeInput(heldBreak) : '');
                        }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[var(--ink)]">{t.name}</span>
                        <span className="block text-xs text-[var(--muted)]">{templateTimes(t)}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {otherTypes.length > 0 && (
                  <p className="mt-1.5 text-xs text-[var(--muted)]">
                    Also on {otherTypes.map((id) => templates.find((t) => t.id === id)?.name ?? 'another shift').join(', ')} on other days.
                    Saving changes only the days you pick here.
                  </p>
                )}
              </fieldset>

              <fieldset>
                <legend className="text-label font-medium text-[var(--muted)]">Days</legend>
                <div className="mb-1.5 mt-1 flex flex-wrap items-center gap-2">
                  <div className="flex gap-1.5">
                    <QuickChip label="Open days" onClick={() => setDays([...openDays])} />
                    <QuickChip label="Mon–Fri" onClick={() => setDays([1, 2, 3, 4, 5])} />
                    <QuickChip label="Clear" onClick={() => setDays([])} />
                  </div>
                </div>
                <div className="grid grid-cols-7 gap-1">
                  {WEEKDAY_ORDER.map((d) => {
                    const on = days.includes(d);
                    const closed = closedDays.includes(d);
                    return (
                      <button
                        key={d}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${WEEKDAY_META[d].full}${closed ? ' (clinic closed)' : ''}`}
                        onClick={() => toggleDay(d)}
                        className={`flex min-h-11 flex-col items-center justify-center rounded-lg border text-sm font-semibold ${
                          on
                            ? 'border-[var(--teal)] bg-[var(--teal)] text-white'
                            : 'border-[var(--border)] bg-[var(--surface)] text-[var(--ink)]'
                        }`}
                      >
                        {WEEKDAY_META[d].short.slice(0, 2)}
                        {closed && <span className={`text-[10px] font-normal ${on ? 'text-white/80' : 'text-[var(--muted)]'}`}>closed</span>}
                      </button>
                    );
                  })}
                </div>
                {(added.length > 0 || removed.length > 0) && (
                  <p className="mt-1.5 text-xs text-[var(--muted)]" data-testid="days-change">
                    {[added.length ? `Adds ${formatWeekdays(added)}` : '', removed.length ? `Removes ${formatWeekdays(removed)}` : '']
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                )}
              </fieldset>

              {template && template.breakDurationMinutes > 0 && template.breakDurationMinutes < 120 && (
                <div>
                  {!breakOpen ? (
                    <button
                      type="button"
                      className="text-sm font-medium text-[var(--teal-strong)] hover:underline"
                      onClick={() => {
                        setBreakOpen(true);
                        if (template.defaultBreakStartMinute !== null) setBreakTime(minutesToTimeInput(template.defaultBreakStartMinute));
                      }}
                    >
                      Change lunch time
                    </button>
                  ) : (
                    <label className="block text-label font-medium text-[var(--muted)]">
                      Lunch starts at ({formatBreakDuration(template.breakDurationMinutes)})
                      <input
                        type="time"
                        step={300}
                        className="mt-1 block min-h-10 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-sm text-[var(--ink)]"
                        value={breakTime}
                        onChange={(e) => setBreakTime(e.target.value)}
                      />
                      {breakProblem && <span className="mt-1 block text-xs text-[var(--rust)]">{breakProblem}</span>}
                    </label>
                  )}
                </div>
              )}
            </div>
          )}

          {kind === 'own' && (
            <div className="space-y-2">
              <p className="text-xs text-[var(--muted)]">Their own days and times. The gap between two times is a break.</p>
              <WorkingHoursEditor hours={own} onChange={setOwn} clinic={clinicHours} />
              {ownProblem && <p className="text-xs text-[var(--rust)]">{ownProblem}</p>}
            </div>
          )}

          {kind === 'clinic' && (
            <p className="text-sm text-[var(--muted)]">
              Uses the clinic&apos;s opening hours: {clinicSummary}. Changes under Schedule &amp; Booking apply automatically.
            </p>
          )}

          {bulk && (
            <p className="text-xs text-[var(--muted)]">Own hours are set one person at a time: tap their name in Weekly shifts.</p>
          )}
        </div>
      </SheetDialog>

      <ConfirmDialog
        open={outside !== null}
        title="Save these hours anyway?"
        message={
          outside
            ? `${outside} upcoming appointment${outside === 1 ? '' : 's'} fall${outside === 1 ? 's' : ''} outside these hours. They stay booked; you can move them on the Schedule.`
            : ''
        }
        confirmLabel="Save anyway"
        onCancel={() => setOutside(null)}
        onConfirm={() => {
          setOutside(null);
          void save(true);
        }}
      />
    </>
  );
}

function templateTimes(t: ShiftTemplate): string {
  if (t.breakDurationMinutes >= 120 && t.defaultBreakStartMinute !== null) {
    const resume = t.defaultBreakStartMinute + t.breakDurationMinutes;
    return `${formatRange12h(t.startMinute, t.defaultBreakStartMinute)} & ${formatRange12h(resume, t.endMinute)}`;
  }
  const range = formatRange12h(t.startMinute, t.endMinute);
  return t.breakDurationMinutes > 0 ? `${range} · ${formatBreakDuration(t.breakDurationMinutes)} lunch` : range;
}

function QuickChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="min-h-8 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

/** The person's current week: the one-line description and a Mon–Sun strip (on, off, clinic closed). */
function CurrentWeek({
  therapist,
  approved,
  templates,
  clinic,
}: {
  therapist: Therapist;
  approved: TherapistShiftAssignment[];
  templates: ShiftTemplate[];
  clinic: Clinic;
}) {
  const desc = describeSchedule(therapist, approved.filter((a) => a.therapistId === therapist.id), templates, clinic);
  const onDays = new Set(desc.groups.flatMap((g) => g.days));
  const closed = clinic.closedWeekdays ?? [];
  return (
    <div className="rounded-xl bg-[var(--paper)] p-3">
      <p className="text-xs text-[var(--muted)]">Now</p>
      <p className="text-sm font-medium text-[var(--ink)]">{desc.headline}</p>
      <p className="text-xs text-[var(--muted)]">{desc.summary}</p>
      <ol className="mt-2 grid grid-cols-7 gap-1" aria-label="This week">
        {WEEKDAY_ORDER.map((d) => {
          const state = onDays.has(d) ? 'on' : closed.includes(d) ? 'closed' : 'off';
          return (
            <li key={d} className="flex flex-col items-center gap-1 text-[11px] text-[var(--muted)]" aria-label={`${WEEKDAY_META[d].full}: ${state === 'on' ? 'working' : state === 'closed' ? 'clinic closed' : 'off'}`}>
              <span aria-hidden>{WEEKDAY_META[d].short.slice(0, 1)}</span>
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-full ${
                  state === 'on' ? 'bg-[var(--teal)]' : state === 'closed' ? 'bg-[var(--border)]' : 'border border-[var(--muted)]'
                }`}
              />
            </li>
          );
        })}
      </ol>
    </div>
  );
}
