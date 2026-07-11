import { useEffect, useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, patientService, dashboardService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import {
  referringSourceDetailLabel,
  REFERRING_SOURCE_LABELS,
  type Patient,
  type ReferringSource,
} from '@/domain/types';
import { fiscalYearOf, monthsOfFiscalYear, monthDateRange, monthName, formatDateDMY } from '@/domain/fiscalYear';
import { btnPrimary, btnSecondary, ErrorNote, Field, inputCls, Pill, PackageThread, td, th } from '@/components/ui';
import { applySort, byNumber, byString, SortHeader, useSort } from '@/components/sortable';
import { toFriendlyMessage } from '@/lib/errors';

type SortKey = 'name' | 'mrno' | 'age' | 'condition';

const COMPARATORS = {
  name: byString<Patient>((p) => p.name),
  mrno: byString<Patient>((p) => p.mrno),
  age: byNumber<Patient>((p) => p.age ?? -1),
  condition: byString<Patient>((p) => p.primaryCondition ?? ''),
};

export function PatientsPage() {
  const clinic = useClinic();
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Patient | null>(null);
  const sort = useSort<SortKey>('name');

  const currentFy = fiscalYearOf(new Date(), clinic.fyStartMonth);
  const [fyStartYear, setFyStartYear] = useState(currentFy.startYear);
  const [month, setMonth] = useState(''); // '' = all time

  const months = useMemo(
    () => monthsOfFiscalYear(fyStartYear, clinic.fyStartMonth),
    [fyStartYear, clinic.fyStartMonth]
  );
  const selectedPeriod = useMemo(() => {
    if (!month) return null;
    const [y, m] = month.split('-').map(Number);
    return { year: y, month: m };
  }, [month]);

  const periodVisits = useLiveQuery(() => {
    if (!selectedPeriod) return Promise.resolve(null);
    const { from, to } = monthDateRange(selectedPeriod);
    return repos.visits.list({ clinicId: clinic.id, from, to });
  }, [clinic.id, selectedPeriod?.year, selectedPeriod?.month]);
  const periodPatientIds = useMemo(
    () => (periodVisits ? new Set(periodVisits.map((v) => v.patientId)) : null),
    [periodVisits]
  );

  const all = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);

  const allVisits = useLiveQuery(() => repos.visits.list({ clinicId: clinic.id }), [clinic.id]);
  const openPackages = useLiveQuery(() => dashboardService.openPackages(clinic.id), [clinic.id]);
  const outstanding = useLiveQuery(() => dashboardService.outstandingInvoices(clinic.id), [clinic.id]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);

  const therapistName = useMemo(
    () => new Map((therapists ?? []).map((t) => [t.id, t.name])),
    [therapists]
  );

  const visitStatsByPatient = useMemo(() => {
    const map = new Map<string, { lastVisitOn: string; visitCount: number; latestVisit: any }>();
    for (const v of allVisits ?? []) {
      if (v.deleted) continue;
      const cur = map.get(v.patientId);
      if (!cur) {
        map.set(v.patientId, { lastVisitOn: v.visitDate, visitCount: 1, latestVisit: v });
      } else {
        cur.visitCount += 1;
        if (v.visitDate > cur.lastVisitOn) {
          cur.lastVisitOn = v.visitDate;
          cur.latestVisit = v;
        }
      }
    }
    return map;
  }, [allVisits]);

  const openPackageByPatient = useMemo(() => {
    const map = new Map<string, { sessionsLogged: number; packageTotal: number }>();
    for (const p of openPackages ?? []) {
      if (!map.has(p.patientId)) map.set(p.patientId, { sessionsLogged: p.sessionsLogged, packageTotal: p.packageTotal });
    }
    return map;
  }, [openPackages]);

  const outstandingMrnos = useMemo(
    () => new Set((outstanding?.rows ?? []).map((r) => r.mrno)),
    [outstanding]
  );

  const q = query.trim().toLowerCase();
  const active = (all ?? []).filter(
    (p) =>
      !p.deletedAt &&
      (!q || p.mrno.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(q)) &&
      (periodPatientIds === null || periodPatientIds.has(p.id))
  );
  const hidden = (all ?? []).filter((p) => p.deletedAt);
  const rows = applySort(active, COMPARATORS, sort);

  async function hide(p: Patient) {
    if (
      !confirm(
        `Hide ${p.name} (${p.mrno})?\n\nThey disappear from search and pickers; their visits stay in the records. You can restore them anytime from "Hidden patients" below.`
      )
    )
      return;
    setError(null);
    try {
      await patientService.hide(p.id);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  async function restore(p: Patient) {
    setError(null);
    try {
      await patientService.restore(p.id);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  async function hardDelete(p: Patient) {
    setError(null);
    try {
      const visits = await repos.visits.list({ clinicId: clinic.id, patientId: p.id });
      if (visits.length > 0) {
        alert(
          `${p.name} has ${visits.length} visit(s) on record, so they can't be permanently deleted — keep them hidden instead.`
        );
        return;
      }
      const typed = prompt(
        `Permanently delete ${p.name} (${p.mrno})? This cannot be undone.\n\nType the patient's name to confirm:`
      );
      if (typed === null) return;
      if (typed.trim().toLowerCase() !== p.name.trim().toLowerCase()) {
        alert('Name did not match — nothing was deleted.');
        return;
      }
      await patientService.hardDelete(p.id);
    } catch (e) {
      setError(toFriendlyMessage(e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Patients</h1>
        <div className="ml-auto flex flex-wrap items-end gap-2">
          <div className="flex gap-2">
            <select
              className={inputCls}
              value={fyStartYear}
              onChange={(e) => setFyStartYear(Number(e.target.value))}
            >
              {[currentFy.startYear - 2, currentFy.startYear - 1, currentFy.startYear].map((y) => (
                <option key={y} value={y}>
                  FY {fiscalYearOf(new Date(y, clinic.fyStartMonth - 1, 1), clinic.fyStartMonth).label}
                </option>
              ))}
            </select>
            <select className={inputCls} value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">All time</option>
              {months.map((m) => (
                <option key={`${m.year}-${m.month}`} value={`${m.year}-${m.month}`}>
                  {monthName(m.month)} {m.year}
                </option>
              ))}
            </select>
          </div>
          <input
            className={`${inputCls} max-w-xs`}
            placeholder="Search by MRNO or name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      {selectedPeriod && (
        <p className="text-xs text-[var(--muted)]">
          Showing patients seen in {monthName(selectedPeriod.month)} {selectedPeriod.year}.{' '}
          <button className="font-medium text-[var(--teal)] hover:underline" onClick={() => setMonth('')}>
            Show all time
          </button>
        </p>
      )}

      {error && (
        <p className="rounded-md border border-[var(--rust)] bg-[var(--rust-light)] px-3 py-2 text-sm text-[var(--rust)]">
          {error}
        </p>
      )}

      <div className="overflow-x-auto rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--paper)]">
            <tr>
              <SortHeader label="MRNO" k="mrno" sort={sort} />
              <SortHeader label="Name" k="name" sort={sort} />
              <SortHeader label="Primary condition" k="condition" sort={sort} />
              <th className={th}>Last visit</th>
              <th className={th}>Therapist</th>
              <th className={th}>Treatment</th>
              <th className={th}>Bill</th>
              <th className={th}>Phone</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((p) => {
              const stats = visitStatsByPatient.get(p.id);
              const pkg = openPackageByPatient.get(p.id);
              const isOutstanding = outstandingMrnos.has(p.mrno);
              return (
              <tr key={p.id} className="hover:bg-[var(--paper)]">
                <td className={td}>
                  {p.mrno}
                  {p.mrnoSource === 'auto' && (
                    <span className="ml-1.5">
                      <Pill tone="slate">walk-in</Pill>
                    </span>
                  )}
                </td>
                <td className={`${td} font-display`}>
                  <Link
                    to="/patients/$patientId"
                    params={{ patientId: p.id }}
                    className="hover:underline"
                  >
                    {p.name}
                  </Link>
                  {(p.age || p.sex) && (
                    <div className="text-xs text-[var(--muted)]">
                      {p.age ?? '-'} / {p.sex ?? '-'}
                    </div>
                  )}
                </td>
                <td className={td}>{p.primaryCondition ?? '-'}</td>
                <td className={td}>
                  {stats ? (
                    <>
                      <div className="font-num text-xs text-[var(--ink)]">
                        {formatDateDMY(stats.lastVisitOn)}
                        <span className="text-[var(--muted)]">
                          {' '}
                          · {stats.visitCount} visit{stats.visitCount === 1 ? '' : 's'}
                        </span>
                      </div>
                      {(pkg || isOutstanding) && (
                        <div className="mt-1 flex items-center gap-1.5">
                          {pkg && (
                            <PackageThread sessionIndex={pkg.sessionsLogged} packageTotal={pkg.packageTotal} />
                          )}
                          {isOutstanding && <Pill tone="amber">Outstanding</Pill>}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-[var(--muted)]">No visits yet</span>
                  )}
                </td>
                <td className={td}>
                  {stats?.latestVisit ? therapistName.get(stats.latestVisit.therapistId) ?? '-' : '-'}
                </td>
                <td className={td}>
                  {stats?.latestVisit?.treatment ? (
                    <span className="text-xs">{stats.latestVisit.treatment}</span>
                  ) : (
                    '-'
                  )}
                </td>
                <td className={`${td} font-num text-right`}>
                  {stats?.latestVisit ? (
                    <span className="text-sm">INR {Math.round(stats.latestVisit.actualBillPaise / 100)}</span>
                  ) : (
                    '-'
                  )}
                </td>
                <td className={td}>{p.phone ?? '-'}</td>
                <td className={`${td} whitespace-nowrap`}>
                  <Link
                    to="/visits"
                    search={{ patientId: p.id }}
                    className="font-medium text-[var(--teal)] hover:underline"
                  >
                    Visit history
                  </Link>
                  <button
                    className="ml-3 text-xs text-[var(--muted)] hover:text-[var(--teal)]"
                    onClick={() => setEditing(p)}
                  >
                    Edit
                  </button>
                  <button
                    className="ml-3 text-xs text-[var(--muted)] hover:text-[var(--rust)]"
                    onClick={() => void hide(p)}
                  >
                    Hide
                  </button>
                </td>
              </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-8 text-center text-sm text-[var(--muted)]">
                  {q
                    ? 'No patients match your search.'
                    : selectedPeriod
                      ? 'No patients were seen in this period.'
                      : 'No patients yet — they’re created from the “New visit” flow.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hidden.length > 0 && (
        <div className="rounded-[10px] border border-[var(--border)] bg-[var(--surface)]">
          <button
            className="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-[var(--ink)] hover:bg-[var(--paper)]"
            onClick={() => setShowHidden((s) => !s)}
          >
            <span>Hidden patients ({hidden.length})</span>
            <span className="text-xs text-[var(--muted)]">{showHidden ? 'Collapse' : 'Show'}</span>
          </button>
          {showHidden && (
            <table className="min-w-full divide-y divide-[var(--border)] border-t border-[var(--border)]">
              <tbody className="divide-y divide-[var(--border)]">
                {hidden.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--paper)]">
                    <td className={td}>
                      <span className="font-display">{p.name}</span> <span className="text-xs text-[var(--muted)]">{p.mrno}</span>
                    </td>
                    <td className={td}>
                      <Pill tone="slate">Hidden {p.deletedAt && formatDateDMY(p.deletedAt)}</Pill>
                    </td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      <button
                        className="text-xs text-[var(--teal)] hover:underline"
                        onClick={() => void restore(p)}
                      >
                        Restore
                      </button>
                      <button
                        className="ml-3 text-xs text-[var(--muted)] hover:text-[var(--rust)]"
                        onClick={() => void hardDelete(p)}
                      >
                        Delete permanently
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing && <EditPatientModal patient={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EditPatientModal({ patient, onClose }: { patient: Patient; onClose: () => void }) {
  const [form, setForm] = useState(patient);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => setForm(patient), [patient]);

  const set = (patch: Partial<Patient>) => setForm((f) => ({ ...f, ...patch }));

  async function save() {
    setError(null);
    if (form.mrno.trim() !== patient.mrno && !confirm(`Change MRNO from ${patient.mrno} to ${form.mrno.trim()}? This may need to match hospital records.`)) {
      return;
    }
    setBusy(true);
    try {
      await patientService.update(patient.id, {
        mrno: form.mrno,
        name: form.name,
        age: form.age,
        sex: form.sex,
        phone: form.phone,
        primaryCondition: form.primaryCondition,
        referringSource: form.referringSource,
        referringSourceDetail: form.referringSourceDetail,
      });
      onClose();
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-4">
      <div className="w-full max-w-md space-y-4 rounded-[10px] bg-[var(--surface)] p-5">
        <h2 className="text-sm font-semibold text-[var(--ink)]">Edit patient</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Name">
            <input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="MRNO">
            <input className={inputCls} value={form.mrno} onChange={(e) => set({ mrno: e.target.value })} />
          </Field>
          <Field label="Age">
            <input
              type="number"
              className={inputCls}
              value={form.age ?? ''}
              onChange={(e) => set({ age: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </Field>
          <Field label="Sex">
            <select
              className={inputCls}
              value={form.sex ?? ''}
              onChange={(e) => set({ sex: (e.target.value || null) as Patient['sex'] })}
            >
              <option value="">—</option>
              <option value="M">M</option>
              <option value="F">F</option>
              <option value="Other">Other</option>
            </select>
          </Field>
          <Field label="Phone">
            <input className={inputCls} value={form.phone ?? ''} onChange={(e) => set({ phone: e.target.value || null })} />
          </Field>
          <Field label="Primary condition">
            <input
              className={inputCls}
              value={form.primaryCondition ?? ''}
              onChange={(e) => set({ primaryCondition: e.target.value || null })}
            />
          </Field>
          <Field label="Referring source">
            <select
              className={inputCls}
              value={form.referringSource ?? ''}
              onChange={(e) =>
                set({
                  referringSource: (e.target.value || null) as ReferringSource | null,
                  referringSourceDetail: null,
                })
              }
            >
              <option value="">—</option>
              {(Object.entries(REFERRING_SOURCE_LABELS) as [ReferringSource, string][]).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                )
              )}
            </select>
          </Field>
          {referringSourceDetailLabel(form.referringSource) && (
            <Field label={referringSourceDetailLabel(form.referringSource)!}>
              <input
                className={inputCls}
                value={form.referringSourceDetail ?? ''}
                onChange={(e) => set({ referringSourceDetail: e.target.value || null })}
              />
            </Field>
          )}
        </div>
        <ErrorNote message={error} />
        <div className="flex justify-end gap-2">
          <button className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button className={btnPrimary} disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
