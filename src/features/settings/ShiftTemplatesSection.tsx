import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, bookingService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { ErrorNote, Field, inputCls, btnPrimary, btnSecondary } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import type { ShiftTemplate } from '@/domain/types';

function minutesToTimeInput(m: number): string {
  const h = Math.floor(m / 60).toString().padStart(2, '0');
  const min = (m % 60).toString().padStart(2, '0');
  return `${h}:${min}`;
}
function timeInputToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
function formatRange(startMinute: number, endMinute: number): string {
  const fmt = (m: number) => {
    const h = Math.floor(m / 60);
    const min = m % 60;
    const period = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${min.toString().padStart(2, '0')} ${period}`;
  };
  return `${fmt(startMinute)} – ${fmt(endMinute)}`;
}

function ShiftTemplateCard({ template }: { template: ShiftTemplate }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(template.name);
  const [start, setStart] = useState(minutesToTimeInput(template.startMinute));
  const [end, setEnd] = useState(minutesToTimeInput(template.endMinute));
  const [breakDuration, setBreakDuration] = useState(String(template.breakDurationMinutes));
  const [breakStart, setBreakStart] = useState(
    template.defaultBreakStartMinute !== null ? minutesToTimeInput(template.defaultBreakStartMinute) : ''
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await bookingService.updateShiftTemplate({
        templateId: template.id,
        name: name.trim(),
        startMinute: timeInputToMinutes(start),
        endMinute: timeInputToMinutes(end),
        breakDurationMinutes: Number(breakDuration) || 0,
        defaultBreakStartMinute: breakStart ? timeInputToMinutes(breakStart) : null,
        active: template.active,
      });
      setEditing(false);
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive() {
    setSaving(true);
    setError(null);
    try {
      await bookingService.updateShiftTemplate({
        templateId: template.id,
        name: template.name,
        startMinute: template.startMinute,
        endMinute: template.endMinute,
        breakDurationMinutes: template.breakDurationMinutes,
        defaultBreakStartMinute: template.defaultBreakStartMinute,
        active: !template.active,
      });
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <Field label="Name"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start"><input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End"><input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Break (minutes)"><input type="number" min={0} className={inputCls} value={breakDuration} onChange={(e) => setBreakDuration(e.target.value)} /></Field>
          <Field label="Default break start"><input type="time" className={inputCls} value={breakStart} onChange={(e) => setBreakStart(e.target.value)} /></Field>
        </div>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={() => { setEditing(false); setError(null); }} disabled={saving}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 ${!template.active ? 'opacity-60' : ''}`}>
      <p className="font-medium text-[var(--ink)]">{template.name}</p>
      <p className="text-sm text-[var(--muted)]">{formatRange(template.startMinute, template.endMinute)}</p>
      {template.breakDurationMinutes > 0 && (
        <p className="text-xs text-[var(--muted)]">
          {template.breakDurationMinutes}-min break
          {template.defaultBreakStartMinute !== null ? `, defaults to ${minutesToTimeInput(template.defaultBreakStartMinute)}` : ''}
        </p>
      )}
      <div className="mt-2 flex gap-3 text-xs font-medium">
        <button
          type="button"
          className="inline-flex min-h-11 items-center px-1 text-[var(--teal)]"
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
        <button
          type="button"
          className="inline-flex min-h-11 items-center px-1 text-[var(--rust)]"
          onClick={() => void toggleActive()}
          disabled={saving}
        >
          {template.active ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>
      <ErrorNote message={error} />
    </div>
  );
}

function ShiftTemplateAddForm({ clinicId }: { clinicId: string }) {
  const [name, setName] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  const [breakDuration, setBreakDuration] = useState('0');
  const [breakStart, setBreakStart] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await bookingService.createShiftTemplate({
        clinicId,
        name: name.trim(),
        startMinute: timeInputToMinutes(start),
        endMinute: timeInputToMinutes(end),
        breakDurationMinutes: Number(breakDuration) || 0,
        defaultBreakStartMinute: breakStart ? timeInputToMinutes(breakStart) : null,
      });
      setName(''); setBreakDuration('0'); setBreakStart('');
    } catch (err) {
      setError(toFriendlyMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] p-4 space-y-3">
      <Field label="Name"><input className={inputCls} placeholder="Morning shift" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start"><input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="End"><input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Break (minutes)"><input type="number" min={0} className={inputCls} value={breakDuration} onChange={(e) => setBreakDuration(e.target.value)} /></Field>
        <Field label="Default break start"><input type="time" className={inputCls} value={breakStart} onChange={(e) => setBreakStart(e.target.value)} /></Field>
      </div>
      <ErrorNote message={error} />
      <button type="button" className={btnPrimary} onClick={() => void add()} disabled={saving || !name.trim()}>
        {saving ? 'Adding…' : '+ Add shift template'}
      </button>
    </div>
  );
}

export function ShiftTemplatesSection() {
  const clinic = useClinic();
  const templates = useLiveQuery(() => repos.shiftTemplates.list(clinic.id, true), [clinic.id]);

  return (
    <div className="space-y-3">
      <h2 className="font-display text-lg font-semibold text-[var(--ink)]">Shift templates</h2>
      <p className="text-sm text-[var(--muted)]">Reusable hours + break patterns you can assign to therapists.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {(templates ?? []).map((t) => <ShiftTemplateCard key={t.id} template={t} />)}
      </div>
      <ShiftTemplateAddForm clinicId={clinic.id} />
    </div>
  );
}
