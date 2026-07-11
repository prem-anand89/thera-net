import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { getSupabase } from '@/lib/supabase';
import { db } from '@/lib/db';
import { formatINR } from '@/domain/money';
import {
  clinicShareLabels,
  effectivePricePerSession,
  visibleVisitColumns,
  VISIT_COLUMN_LABELS,
  type CatalogItem,
  type Clinic,
  type VisitColumnKey,
} from '@/domain/types';
import type { TdsBasis } from '@/domain/split';
import {
  Field,
  inputCls,
  btnPrimary,
  btnSecondary,
  ErrorNote,
  RupeeInput,
  SectionCard,
  th,
  thNum,
  td,
  tdNum,
  InfoTip,
} from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';

export function SetupPage() {
  return (
    <div className="space-y-6">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Setup</h1>
      <ClinicProfile />
      <Catalog />
      <Therapists />
      <SectionCard title="Historical data">
        <p className="mb-3 text-xs text-[var(--muted)]">
          One-time import of visits logged before go-live in the Excel ledger.
        </p>
        <Link to="/setup/import-visits" className="text-sm text-[var(--teal)] hover:underline">
          Import historical visits from Excel →
        </Link>
      </SectionCard>
      <DangerZone />
    </div>
  );
}

function DangerZone() {
  const clinic = useClinic();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function resetLocalCache() {
    if (
      !confirm(
        "Clear this device's local copy of the data?\n\nNothing on the server is affected — the app reloads and downloads everything fresh. Use this after a wipe, or if this device is showing stale data."
      )
    )
      return;
    setError(null);
    setBusy(true);
    try {
      // db.delete() can hang indefinitely if another connection (another open
      // tab, or this page's own live queries) is holding the database — in
      // which case the browser silently "blocks" the delete. Race it against a
      // timeout so a stuck delete surfaces as an actionable error instead of
      // the button appearing to do nothing.
      await Promise.race([
        db.delete(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('blocked')), 5000)),
      ]);
      location.reload();
    } catch (e) {
      console.error('reset local cache failed', e);
      setError(
        'Could not clear the local data automatically. Close any other Thera.Net tabs or windows, then reload this page and try again.'
      );
      setBusy(false);
    }
  }

  async function wipeAll() {
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('Wiping needs a connection — try again when online.');
      return;
    }
    const typed = prompt(
      'This permanently deletes ALL patients, visits, invoices, payments and settlements for this clinic, and resets invoice numbering to 0001. The catalog, therapists, and logins are kept.\n\nThis cannot be undone. Type WIPE to confirm:'
    );
    if (typed !== 'WIPE') return;
    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_wipe_clinic_data', {
        p_clinic_id: clinic.id,
      });
      if (rpcError) throw new Error(rpcError.message);
      const counts = data as { patients: number; visits: number; invoices: number };
      alert(
        `Wiped ${counts.patients} patients, ${counts.visits} visits, and ${counts.invoices} invoices. The app will now reload with a clean slate.\n\nOn any OTHER device that was already signed in, use "Reset local cache" once.`
      );
      await db.delete();
      location.reload();
    } catch (e) {
      setError(toFriendlyMessage(e));
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Danger zone">
      <p className="mb-3 text-xs text-[var(--muted)]">
        For test-data cleanup and troubleshooting. Wiping is admin-only and enforced by the server.
      </p>
      <div className="flex flex-wrap gap-2">
        <button className={btnSecondary} disabled={busy} onClick={() => void resetLocalCache()}>
          {busy ? 'Working…' : 'Reset local cache on this device'}
        </button>
        <button
          className="rounded-md border border-[var(--rust)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--rust)] hover:bg-[var(--rust-light)] disabled:opacity-50"
          disabled={busy}
          onClick={() => void wipeAll()}
        >
          {busy ? 'Wiping…' : 'Wipe ALL clinic data…'}
        </button>
      </div>
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>
    </SectionCard>
  );
}

function ClinicProfile() {
  const clinic = useClinic();
  const [form, setForm] = useState<Clinic>(clinic);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labels = clinicShareLabels(form);

  useEffect(() => setForm(clinic), [clinic]);

  const set = (patch: Partial<Clinic>) => {
    setSaved(false);
    setForm((f) => ({ ...f, ...patch }));
  };

  async function uploadLogo(file: File, field: 'logoPath' | 'partnerHospitalLogoPath') {
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('Logo upload needs a connection.');
      return;
    }
    const path = `${clinic.id}/${field === 'logoPath' ? 'logo' : 'partner-logo'}-${Date.now()}.${file.name.split('.').pop()}`;
    const { error } = await supabase.storage.from('clinic-assets').upload(path, file);
    if (error) {
      setError(`Upload failed: ${toFriendlyMessage(error)}`);
      return;
    }
    const updated = { ...form, [field]: path, updatedAt: new Date().toISOString() };
    setForm(updated);
    await repos.clinics.put(updated);
  }

  async function save() {
    setError(null);
    await repos.clinics.put({ ...form, updatedAt: new Date().toISOString() });
    setSaved(true);
  }

  return (
    <SectionCard title="Clinic profile & letterhead">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Field label="Clinic name">
          <input className={inputCls} value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Invoice prefix">
          <input
            className={inputCls}
            value={form.invoicePrefix}
            onChange={(e) => set({ invoicePrefix: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="GST / Tax ID (optional)">
          <input className={inputCls} value={form.gstNo ?? ''} onChange={(e) => set({ gstNo: e.target.value || null })} />
        </Field>
        <Field
          label={
            <>
              Therapist setup
              <InfoTip text="Individual: single therapist practice. Multiple: clinic with multiple therapists. This affects billing and reporting." />
            </>
          }
        >
          <select
            className={inputCls}
            value={form.clinicType ?? 'multiple'}
            onChange={(e) => set({ clinicType: e.target.value as Clinic['clinicType'] })}
          >
            <option value="individual">Individual Therapist</option>
            <option value="multiple">Multiple Therapists</option>
          </select>
        </Field>
        <Field
          label={
            <>
              Partner with external organization
              <InfoTip text="Enable if your clinic partners with a hospital or another organization for revenue sharing, tax deduction, or other arrangements." />
            </>
          }
        >
          <select
            className={inputCls}
            value={form.hasPartner ? 'yes' : 'no'}
            onChange={(e) => set({ hasPartner: e.target.value === 'yes' })}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </Field>
        <Field
          label={
            <>
              Track therapist splits
              <InfoTip text="Lets a visit's revenue be credited between two therapists (a Split action + Shared/Net report columns). Turn off if you don't attribute revenue across therapists." />
            </>
          }
        >
          <select
            className={inputCls}
            value={form.enableTherapistSplit === false ? 'no' : 'yes'}
            onChange={(e) => set({ enableTherapistSplit: e.target.value === 'yes' })}
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </Field>
        <Field label="Address">
          <input className={inputCls} value={form.address ?? ''} onChange={(e) => set({ address: e.target.value || null })} />
        </Field>
        <Field label="Phone">
          <input className={inputCls} value={form.phone ?? ''} onChange={(e) => set({ phone: e.target.value || null })} />
        </Field>
        <Field label="Email">
          <input className={inputCls} value={form.email ?? ''} onChange={(e) => set({ email: e.target.value || null })} />
        </Field>
        {form.hasPartner && (
          <>
            <Field label="Partner name (prints on invoices if set)">
              <input
                className={inputCls}
                value={form.partnerHospitalName ?? ''}
                onChange={(e) => set({ partnerHospitalName: e.target.value || null })}
              />
            </Field>
            <Field label="Your share label (report column, e.g. BM)">
              <input
                className={inputCls}
                placeholder="BM"
                value={form.ownShareLabel ?? ''}
                onChange={(e) => set({ ownShareLabel: e.target.value || null })}
              />
            </Field>
            <Field label="Partner share label (report column, e.g. HV)">
              <input
                className={inputCls}
                placeholder="HV"
                value={form.partnerShareLabel ?? ''}
                onChange={(e) => set({ partnerShareLabel: e.target.value || null })}
              />
            </Field>
            <Field label={`Your share % (${labels.own} split)`}>
              <input
                type="number"
                className={inputCls}
                value={form.bmSplitPct}
                onChange={(e) => set({ bmSplitPct: Number(e.target.value) })}
              />
            </Field>
          </>
        )}
        <Field
          label={
            <>
              Tax / TDS % (optional)
              <InfoTip text="Tax Deducted at Source — the % withheld from payouts. Leave blank if not applicable. When enabled with a partner, TDS is calculated based on the TDS basis below." />
            </>
          }
        >
          <input
            type="number"
            className={inputCls}
            placeholder="0"
            value={form.taxPct ?? ''}
            onChange={(e) => set({ taxPct: e.target.value === '' ? 0 : Number(e.target.value) })}
          />
        </Field>
        {form.hasPartner && form.taxPct > 0 && (
          <Field
            label={
              <>
                TDS basis
                <InfoTip text="Whether the tax % is calculated on the full bill (matches most hospital sheets) or only on the clinic's own share. Both produce the same final clinic payout." />
              </>
            }
          >
            <select
              className={inputCls}
              value={form.tdsBasis}
              onChange={(e) => set({ tdsBasis: e.target.value as TdsBasis })}
            >
              <option value="gross_bill">{form.taxPct}% of gross bill (matches {labels.partner} sheet)</option>
              <option value="bm_share">On clinic share only</option>
            </select>
          </Field>
        )}
        <Field label="Fiscal year starts in month">
          <input
            type="number"
            min={1}
            max={12}
            className={inputCls}
            value={form.fyStartMonth}
            onChange={(e) => set({ fyStartMonth: Number(e.target.value) })}
          />
        </Field>
        <Field label="Clinic logo">
          <input
            type="file"
            accept="image/*"
            className={inputCls}
            onChange={(e) => e.target.files?.[0] && void uploadLogo(e.target.files[0], 'logoPath')}
          />
        </Field>
        {form.hasPartner && (
          <Field label="Partner logo">
            <input
              type="file"
              accept="image/*"
              className={inputCls}
              onChange={(e) =>
                e.target.files?.[0] && void uploadLogo(e.target.files[0], 'partnerHospitalLogoPath')
              }
            />
          </Field>
        )}
      </div>

      <div className="mt-4 border-t border-[var(--border)] pt-4">
        <p className="mb-2 text-xs font-medium text-[var(--muted)]">
          Visits table columns — pick which optional columns show
        </p>
        <div className="flex flex-wrap gap-4">
          {(Object.keys(VISIT_COLUMN_LABELS) as VisitColumnKey[]).map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm text-[var(--ink)]">
              <input
                type="checkbox"
                checked={visibleVisitColumns(form)[key]}
                onChange={(e) =>
                  set({ visitColumnPrefs: { ...form.visitColumnPrefs, [key]: e.target.checked } })
                }
              />
              {VISIT_COLUMN_LABELS[key]}
            </label>
          ))}
        </div>
        {form.hasPartner && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            The {labels.own} Share and Post-Tax columns appear in ledger and reports when a partner is configured.
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button className={btnPrimary} onClick={() => void save()}>
          Save clinic settings
        </button>
        {saved && <span className="text-sm text-[var(--moss)]">Saved ✓</span>}
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Split/tax changes apply to NEW visits only — past visits keep the rates they were billed
        under.
      </p>
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>
    </SectionCard>
  );
}

function Catalog() {
  const clinic = useClinic();
  const items = useLiveQuery(() => repos.catalog.list(clinic.id, true), [clinic.id]);
  const [draft, setDraft] = useState({ category: '', name: '', sessionCount: '1' });
  const [draftPrice, setDraftPrice] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function addItem() {
    setError(null);
    if (!draft.category.trim() || !draft.name.trim() || draftPrice == null) {
      setError('Category, name, and price are required');
      return;
    }
    const item: CatalogItem = {
      id: crypto.randomUUID(),
      clinicId: clinic.id,
      category: draft.category.trim(),
      name: draft.name.trim(),
      sessionCount: Math.max(1, Number(draft.sessionCount) || 1),
      basePricePaise: draftPrice,
      active: true,
      updatedAt: new Date().toISOString(),
    };
    await repos.catalog.put(item);
    setDraft({ category: draft.category, name: '', sessionCount: '1' });
    setDraftPrice(null);
  }

  async function toggleActive(item: CatalogItem) {
    await repos.catalog.put({ ...item, active: !item.active, updatedAt: new Date().toISOString() });
  }

  async function updatePrice(item: CatalogItem, pricePaise: number | null) {
    if (pricePaise == null) return;
    await repos.catalog.put({
      ...item,
      basePricePaise: pricePaise,
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <SectionCard title="Service catalog">
      <p className="mb-3 text-xs text-[var(--muted)]">
        Price changes affect FUTURE visits only — logged visits keep their price snapshot.
        Deactivate instead of deleting so history keeps resolving; per-session price is always
        derived (price ÷ sessions), never stored.
      </p>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-[var(--border)]">
          <thead className="bg-[var(--paper)]">
            <tr>
              <th className={th}>Category</th>
              <th className={th}>Package</th>
              <th className={thNum}>Sessions</th>
              <th className={thNum}>Price</th>
              <th className={thNum}>Per session</th>
              <th className={th}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {(items ?? []).map((item) => (
              <tr key={item.id} className={item.active ? '' : 'opacity-50'}>
                <td className={td}>{item.category}</td>
                <td className={td}>{item.name}</td>
                <td className={tdNum}>{item.sessionCount}</td>
                <td className={`${tdNum} w-32`}>
                  <RupeeInput
                    valuePaise={item.basePricePaise}
                    onChange={(p) => void updatePrice(item, p)}
                  />
                </td>
                <td className={tdNum}>{formatINR(effectivePricePerSession(item))}</td>
                <td className={td}>
                  <button
                    className="text-xs text-[var(--teal)] hover:underline"
                    onClick={() => void toggleActive(item)}
                  >
                    {item.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
            <tr className="bg-[var(--paper)]/50">
              <td className={td}>
                <input
                  className={inputCls}
                  placeholder="Category"
                  list="catalog-categories"
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value })}
                />
                <datalist id="catalog-categories">
                  {[...new Set((items ?? []).map((i) => i.category))].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </td>
              <td className={td}>
                <input
                  className={inputCls}
                  placeholder="Package name"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </td>
              <td className={`${td} w-24`}>
                <input
                  type="number"
                  min={1}
                  className={inputCls}
                  value={draft.sessionCount}
                  onChange={(e) => setDraft({ ...draft, sessionCount: e.target.value })}
                />
              </td>
              <td className={`${td} w-32`}>
                <RupeeInput valuePaise={draftPrice} onChange={setDraftPrice} />
              </td>
              <td className={td} colSpan={2}>
                <button className={btnSecondary} onClick={() => void addItem()}>
                  + Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>
    </SectionCard>
  );
}

interface ClinicMember {
  userId: string;
  email: string;
  role: string;
}

function Therapists() {
  const clinic = useClinic();
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const [name, setName] = useState('');
  const [members, setMembers] = useState<ClinicMember[] | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) return;
    (async () => {
      const { data, error } = await supabase.rpc('list_clinic_members_with_email', {
        p_clinic_id: clinic.id,
      });
      if (error) {
        setMembersError(toFriendlyMessage(new Error(error.message)));
        return;
      }
      setMembers(
        (data as { user_id: string; email: string; role: string }[]).map((m) => ({
          userId: m.user_id,
          email: m.email,
          role: m.role,
        }))
      );
    })();
  }, [clinic.id]);

  async function add() {
    if (!name.trim()) return;
    await repos.therapists.put({
      id: crypto.randomUUID(),
      clinicId: clinic.id,
      name: name.trim(),
      active: true,
      updatedAt: new Date().toISOString(),
    });
    setName('');
  }

  return (
    <SectionCard title="Therapists">
      <ul className="mb-3 space-y-2">
        {(therapists ?? []).map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-3 text-sm">
            <span className={`min-w-32 ${t.active ? '' : 'text-[var(--muted)] line-through'}`}>{t.name}</span>
            <button
              className="text-xs text-[var(--teal)] hover:underline"
              onClick={() =>
                void repos.therapists.put({
                  ...t,
                  active: !t.active,
                  updatedAt: new Date().toISOString(),
                })
              }
            >
              {t.active ? 'Deactivate' : 'Reactivate'}
            </button>
            {members && members.length > 0 && (
              <label className="ml-auto flex items-center gap-2 text-xs text-[var(--muted)]">
                Linked login
                <select
                  className={inputCls}
                  value={t.userId ?? ''}
                  onChange={(e) =>
                    void repos.therapists.put({
                      ...t,
                      userId: e.target.value || null,
                      updatedAt: new Date().toISOString(),
                    })
                  }
                >
                  <option value="">— None —</option>
                  {members.map((m) => (
                    <option key={m.userId} value={m.userId}>
                      {m.email}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </li>
        ))}
      </ul>
      <div className="flex max-w-sm gap-2">
        <input
          className={inputCls}
          placeholder="New therapist name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button className={btnSecondary} onClick={() => void add()}>
          + Add
        </button>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        Deactivating keeps history intact — past visits still show the therapist.
        {members && members.length > 0 && (
          <>
            {' '}
            Linking a therapist to their own login lets edit history show their name instead of
            "another user".
          </>
        )}
      </p>
      <ErrorNote message={membersError} />
    </SectionCard>
  );
}

