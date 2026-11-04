import { askConfirm } from '@/lib/notify';
import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { repos, bookingService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { useEntitlements } from '@/app/useEntitlements';
import { Field, SectionCard, SheetDialog, btnPrimary, btnSecondary, inputCls } from '@/components/ui';
import { nameCheck, nameCheckBlocks } from '@/domain/nameCheck';
import { toFriendlyMessage } from '@/lib/errors';
import { formatRange12h, formatShiftSummary, getTemplatePalette, templateUsage } from './shiftUtils';
import { ShiftTimesEditor } from './ShiftTimesEditor';
import { HiddenItemsFooter, NameCheckNote } from './catalogShared';
import {
  DEFAULT_SHIFT_DRAFT,
  STARTER_SHIFTS,
  draftFromTemplate,
  draftProblem,
  fieldsFromDraft,
  type ShiftDraft,
} from './shiftDraft';
import type { ShiftTemplate } from '@/domain/types';

/** "8:00 AM – 4:30 PM · 30-min break", or "Morning: … & Evening: …" for a split. */
function describeStarter(shift: (typeof STARTER_SHIFTS)[number]): string {
  const info = formatShiftSummary({ ...shift.fields, id: '', clinicId: '', name: shift.name, active: true, updatedAt: '' });
  return info.isSplit && info.splitDetails
    ? info.splitDetails
    : `${formatRange12h(shift.fields.startMinute, shift.fields.endMinute)} · ${shift.fields.breakDurationMinutes}-min break`;
}

function timesLine(template: ShiftTemplate): string {
  const info = formatShiftSummary(template);
  if (info.isSplit && info.splitDetails) return info.splitDetails;
  const range = formatRange12h(template.startMinute, template.endMinute);
  return template.breakDurationMinutes > 0 ? `${range} · ${template.breakDurationMinutes}-min break` : range;
}

type Sheet = { kind: 'add' } | { kind: 'edit'; template: ShiftTemplate };

/**
 * "Shift types": the reusable shifts a clinic assigns to people (Morning, Evening, Split…). One list card, a row per
 * type with its times and who uses it; "+ Add" and a tap on a row open the same sheet. Hidden types sit in a footer.
 */
export function ShiftTemplatesSection() {
  const clinic = useClinic();
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinic.id, true), [clinic.id]);
  const assignments = useLiveQuery(() => repos.therapistShiftAssignments.listByClinic(clinic.id), [clinic.id]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const entitlements = useEntitlements(clinic.id);

  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [hiddenOpen, setHiddenOpen] = useState(false);
  const [starterBusy, setStarterBusy] = useState(false);
  const [starterError, setStarterError] = useState<string | null>(null);
  // Shifts only help a clinic with a team to roster; a one-login plan is not offered the starter set.
  const oneLogin = entitlements.enforcementEnabled && !entitlements.loading && entitlements.maxMembers <= 1;

  async function addStarterShifts() {
    setStarterBusy(true);
    setStarterError(null);
    try {
      for (const shift of STARTER_SHIFTS) {
        await bookingService.createShiftTemplate({ clinicId: clinic.id, name: shift.name, ...shift.fields });
      }
    } catch (err) {
      setStarterError(toFriendlyMessage(err));
    } finally {
      setStarterBusy(false);
    }
  }

  const therapistMap = useMemo(() => new Map((therapists ?? []).map((t) => [t.id, t.name])), [therapists]);
  const all = useMemo(() => templates ?? [], [templates]);
  const shown = useMemo(() => all.filter((t) => t.active), [all]);
  const hidden = useMemo(() => all.filter((t) => !t.active), [all]);
  const usedBy = (id: string) => templateUsage(id, assignments ?? []).map((tid) => therapistMap.get(tid) ?? 'Staff');

  // A one-therapist clinic with no shift types doesn't need the card: their hours are set on the Working hours card.
  const soloWithoutTypes = (therapists ?? []).filter((t) => t.active !== false).length === 1 && all.length === 0;
  if (soloWithoutTypes && !sheet) return null;

  return (
    <div data-testid="shift-templates-section" className="mt-4">
      <SectionCard
        id="settings-card-team-shift-types"
        title="Shift types"
        action={
          <button type="button" className={`${btnPrimary} min-h-9 px-3 text-sm`} onClick={() => setSheet({ kind: 'add' })}>
            + Add
          </button>
        }
      >
        <p className="mb-3 text-xs text-[var(--muted)]">
          Reusable shifts you give to your team, like Morning or Evening. Change a type and everyone on it follows.
        </p>

        {shown.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-5 text-center text-xs text-[var(--muted)]">
            {hidden.length > 0 ? 'No active shift types. Turn one back on under Inactive, or add one with "+ Add".' : 'No shift types yet. Add the first one with "+ Add".'}
            {!oneLogin && all.length === 0 && (
              <div className="mt-3 space-y-2">
                <p>Or start from three common shifts you can change afterwards:</p>
                <ul className="mx-auto w-fit text-left">
                  {STARTER_SHIFTS.map((shift) => (
                    <li key={shift.name}>
                      <strong className="text-[var(--ink)]">{shift.name}</strong> · {describeStarter(shift)}
                    </li>
                  ))}
                </ul>
                <button type="button" className={btnSecondary} disabled={starterBusy} onClick={() => void addStarterShifts()}>
                  {starterBusy ? 'Adding…' : 'Add suggested shifts'}
                </button>
                {starterError && <p role="alert" className="text-[var(--rust)]">{starterError}</p>}
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-clip rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            {shown.map((t) => (
              <TypeRow key={t.id} template={t} usedBy={usedBy(t.id)} onOpen={() => setSheet({ kind: 'edit', template: t })} />
            ))}
          </div>
        )}

        <HiddenItemsFooter label="Inactive" count={hidden.length} open={hiddenOpen} onToggle={() => setHiddenOpen((v) => !v)}>
          {hidden.map((t) => (
            <TypeRow key={t.id} template={t} usedBy={usedBy(t.id)} dim onOpen={() => setSheet({ kind: 'edit', template: t })} />
          ))}
        </HiddenItemsFooter>
      </SectionCard>

      {sheet && (
        <TypeSheet
          key={sheet.kind === 'edit' ? sheet.template.id : 'add'}
          mode={sheet}
          all={all}
          clinicId={clinic.id}
          usedBy={sheet.kind === 'edit' ? usedBy(sheet.template.id) : []}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

function TypeRow({ template, usedBy, dim = false, onOpen }: { template: ShiftTemplate; usedBy: string[]; dim?: boolean; onOpen: () => void }) {
  const pal = getTemplatePalette(template.id);
  return (
    <button
      type="button"
      aria-label={`Edit ${template.name}`}
      onClick={onOpen}
      className={`flex min-h-11 w-full items-center gap-3 border-t border-[var(--border)] px-3 py-2.5 text-left first:border-t-0 hover:bg-[var(--paper)] active:bg-[var(--paper)] ${dim ? 'opacity-60' : ''}`}
    >
      <span aria-hidden className={`h-3 w-3 shrink-0 rounded-full border ${pal.bg} ${pal.border}`} />
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-medium text-[var(--ink)]">{template.name}</span>
        <span className="block text-xs text-[var(--muted)]">{timesLine(template)}</span>
        <span className="block text-xs text-[var(--muted)]">{usedBy.length > 0 ? `Used by ${usedBy.join(', ')}` : 'Not used yet'}</span>
      </span>
      <span aria-hidden="true" className="shrink-0 text-lg text-[var(--muted)]">›</span>
    </button>
  );
}

/** "Add a shift type" / "Edit shift type": name (checked as you type), the times, shown or hidden, delete. */
function TypeSheet({
  mode,
  all,
  clinicId,
  usedBy,
  onClose,
}: {
  mode: Sheet;
  all: ShiftTemplate[];
  clinicId: string;
  usedBy: string[];
  onClose: () => void;
}) {
  const editing = mode.kind === 'edit' ? mode.template : null;
  const [name, setName] = useState(editing?.name ?? '');
  const [draft, setDraft] = useState<ShiftDraft>(() => (editing ? draftFromTemplate(editing) : DEFAULT_SHIFT_DRAFT));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = nameCheck(name, all.map((t) => ({ id: t.id, name: t.name, active: t.active })), { selfId: editing?.id });
  const problem = draftProblem(name, draft);
  const canSave = !saving && problem === null && !nameCheckBlocks(check);

  async function run(work: () => Promise<void>) {
    setSaving(true);
    setError(null);
    try {
      await work();
      onClose();
    } catch (err) {
      setError(toFriendlyMessage(err));
      setSaving(false);
    }
  }

  const save = () =>
    run(async () => {
      const fields = fieldsFromDraft(draft);
      if (editing) {
        await bookingService.updateShiftTemplate({ templateId: editing.id, name: name.trim(), ...fields, active: editing.active });
      } else {
        await bookingService.createShiftTemplate({ clinicId, name: name.trim(), ...fields });
      }
    });

  const setShown = (active: boolean) =>
    run(async () => {
      if (!editing) return;
      await bookingService.updateShiftTemplate({
        templateId: editing.id,
        name: editing.name,
        startMinute: editing.startMinute,
        endMinute: editing.endMinute,
        breakDurationMinutes: editing.breakDurationMinutes,
        defaultBreakStartMinute: editing.defaultBreakStartMinute,
        active,
      });
    });

  async function remove() {
    if (!editing) return;
    if (usedBy.length > 0) {
      setError(`Can't delete while ${usedBy.join(', ')} ${usedBy.length === 1 ? 'is' : 'are'} on it. Make it inactive instead, or move them to another shift first.`);
      return;
    }
    const ok = await askConfirm({
      title: 'Delete this shift type?',
      message: `Permanently delete "${editing.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await run(async () => {
      await bookingService.deleteShiftTemplate(editing.id);
      await db.shift_templates.update(editing.id, { removedAt: new Date().toISOString(), active: false });
    });
  }

  return (
    <SheetDialog
      open
      title={editing ? 'Edit shift type' : 'Add a shift type'}
      onClose={onClose}
      busy={saving}
      error={error}
      footer={
        <div className="flex items-center justify-between gap-2">
          {editing ? (
            <button
              type="button"
              className="min-h-10 text-sm font-medium text-[var(--muted)] hover:underline disabled:opacity-50"
              disabled={saving}
              onClick={() => void setShown(!editing.active)}
            >
              {editing.active ? 'Make inactive' : 'Make active'}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={btnPrimary} disabled={!canSave} onClick={() => void save()}>
              {saving ? 'Saving…' : editing ? 'Save' : 'Add'}
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {editing && usedBy.length > 0 && (
          <p className="rounded-xl border border-[var(--amber)] bg-[var(--amber-light)]/40 p-2.5 text-xs text-[var(--ink)]">
            {usedBy.join(', ')} {usedBy.length === 1 ? 'is' : 'are'} on this shift. Changing the times changes their hours straight away.
          </p>
        )}
        <Field label="Name">
          <input className={inputCls} value={name} placeholder="e.g. Morning, Evening" autoComplete="off" onChange={(e) => setName(e.target.value)} />
          <NameCheckNote
            result={check}
            hiddenText="is inactive"
            restoreLabel={editing ? undefined : 'Make it active again'}
            onRestore={
              editing
                ? undefined
                : (match) =>
                    void run(async () => {
                      await bookingService.updateShiftTemplate({
                        templateId: match.id,
                        name: match.name,
                        ...(() => {
                          const t = all.find((x) => x.id === match.id)!;
                          return {
                            startMinute: t.startMinute,
                            endMinute: t.endMinute,
                            breakDurationMinutes: t.breakDurationMinutes,
                            defaultBreakStartMinute: t.defaultBreakStartMinute,
                          };
                        })(),
                        active: true,
                      });
                    })
            }
            onUse={setName}
          />
        </Field>
        <ShiftTimesEditor draft={draft} onChange={setDraft} />
        {problem && name.trim() !== '' && <p className="text-xs text-[var(--rust)]">{problem}</p>}
        {editing && (
          <div className="border-t border-[var(--border)] pt-3">
            <button
              type="button"
              className="min-h-10 text-sm font-medium text-[var(--rust)] hover:underline disabled:opacity-50"
              disabled={saving}
              onClick={() => void remove()}
            >
              Delete this shift type
            </button>
          </div>
        )}
      </div>
    </SheetDialog>
  );
}
