import { FormEvent, useState } from 'react';
import { db } from '@/lib/db';
import { repos } from '@/services';
import { Field, inputCls, btnPrimary, btnSecondary, ErrorNote } from '@/components/ui';
import type { Clinic } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';
import { toFriendlyMessage } from '@/lib/errors';

interface CreateClinicFormProps {
  onSuccess: () => void;
}

/**
 * Clinic creation is a one-time, online-only operation — the user is by
 * definition at a login/setup screen with a live connection, exactly like
 * invoice issuance. It goes through the create_clinic_with_admin() RPC
 * (one synchronous, authoritative round trip) rather than the local-first
 * outbox: routing it through repos.clinics.put() plus a separate direct
 * client-side clinic_members insert used to fail RLS almost every time,
 * because that insert requires is_clinic_admin(clinic_id), which depends on
 * the clinic row already existing on the server — but the outbox push is
 * async and debounced, so it usually hadn't landed yet. The RPC's AFTER
 * INSERT trigger (add_creator_as_admin) adds the creator as admin
 * atomically in the same transaction, so there's nothing left to race.
 */
export function CreateClinicForm({ onSuccess }: CreateClinicFormProps) {
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      setError('Clinic name is required');
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const supabase = getSupabase();
      if (!supabase) {
        setError('Supabase not configured');
        setBusy(false);
        return;
      }

      const { data, error: rpcError } = await supabase.rpc('create_clinic_with_admin', {
        p_name: form.name.trim(),
        p_email: form.email.trim(),
        p_phone: form.phone.trim(),
        p_address: form.address.trim(),
        p_invoice_prefix: form.name.trim().slice(0, 3).toUpperCase(),
      });

      if (rpcError) {
        setError(toFriendlyMessage(rpcError));
        setBusy(false);
        return;
      }

      const row = data as {
        id: string;
        name: string;
        email: string | null;
        phone: string | null;
        address: string | null;
        gst_no: string | null;
        logo_path: string | null;
        partner_hospital_name: string | null;
        partner_hospital_logo_path: string | null;
        invoice_prefix: string;
        bm_split_pct: number;
        tax_pct: number;
        tds_basis: 'gross_bill' | 'bm_share';
        fy_start_month: number;
        enable_therapist_split: boolean;
        enable_expected_today: boolean;
        updated_at: string;
      };

      const clinic: Clinic = {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        address: row.address,
        gstNo: row.gst_no,
        logoPath: row.logo_path,
        partnerHospitalName: row.partner_hospital_name,
        partnerHospitalLogoPath: row.partner_hospital_logo_path,
        invoicePrefix: row.invoice_prefix,
        bmSplitPct: row.bm_split_pct,
        taxPct: row.tax_pct,
        tdsBasis: row.tds_basis,
        fyStartMonth: row.fy_start_month,
        enableTherapistSplit: row.enable_therapist_split,
        enableExpectedToday: row.enable_expected_today,
        updatedAt: row.updated_at,
      };

      // Server already confirmed this row (and added us as admin, in the
      // same transaction) — cache it locally without re-queuing an outbox
      // push of our own.
      await repos.clinics.putLocal(clinic);
      await db.meta.put({ key: 'activeClinicId', value: clinic.id });

      setBusy(false);
      onSuccess();
    } catch (err) {
      console.error('Clinic creation error:', err);
      setError(err instanceof Error ? toFriendlyMessage(err) : 'Failed to create clinic');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-24 max-w-sm">
      <div className="mb-6 flex flex-col items-center gap-2">
        <img src="/apple-touch-icon.png" alt="" className="h-12 w-12 rounded-[12px]" />
        <h1 className="font-display text-xl font-semibold text-[var(--ink)]">Create your clinic</h1>
        <p className="text-sm text-[var(--muted)]">Get started with Thera.Net</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6">
        <Field label="Clinic name *">
          <input
            type="text"
            required
            className={inputCls}
            placeholder="e.g., Beyond Mechanics"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </Field>
        <Field label="Email">
          <input
            type="email"
            className={inputCls}
            placeholder="clinic@example.com"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
          />
        </Field>
        <Field label="Phone">
          <input
            type="tel"
            className={inputCls}
            placeholder="Enter phone number"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
        </Field>
        <Field label="Address">
          <input
            type="text"
            className={inputCls}
            placeholder="Clinic address"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
        </Field>
        <ErrorNote message={error} />
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? 'Creating clinic…' : 'Create clinic'}
        </button>
        <button
          type="button"
          className={`${btnSecondary} w-full`}
          onClick={() => getSupabase()?.auth.signOut()}
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
