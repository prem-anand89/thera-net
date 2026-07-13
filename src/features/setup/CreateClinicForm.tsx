import { FormEvent, useState } from 'react';
import { db } from '@/lib/db';
import { repos } from '@/services';
import { Field, inputCls, btnPrimary, ErrorNote } from '@/components/ui';
import type { Clinic } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';

interface CreateClinicFormProps {
  onSuccess: () => void;
}

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

      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData.session?.user.id;
      if (!userId) {
        setError('Not signed in');
        setBusy(false);
        return;
      }

      // Create clinic
      const clinic: Clinic = {
        id: crypto.randomUUID(),
        name: form.name.trim(),
        email: form.email || null,
        phone: form.phone || null,
        address: form.address || null,
        gstNo: null,
        logoPath: null,
        partnerHospitalName: null,
        partnerHospitalLogoPath: null,
        invoicePrefix: form.name.slice(0, 3).toUpperCase(),
        bmSplitPct: 50,
        taxPct: 18,
        tdsBasis: 'gross_bill',
        fyStartMonth: 4,
        enableTherapistSplit: false,
        updatedAt: new Date().toISOString(),
      };

      // Save clinic and add user as member
      await repos.clinics.put(clinic);

      // Add current user to clinic_members via RPC or direct insert
      // Since RLS allows insert if auth.uid() IS NOT NULL, this should work
      const { error: memberError } = await supabase
        .from('clinic_members')
        .insert({
          clinic_id: clinic.id,
          user_id: userId,
          role: 'admin',
        });

      if (memberError) {
        console.error('Error adding clinic member:', memberError);
        // Clinic was created but member add failed - clinic is orphaned
        setError(`Clinic created but couldn't add you as member: ${memberError.message}`);
        setBusy(false);
        return;
      }

      // Set as active clinic
      await db.meta.put({ key: 'activeClinicId', value: clinic.id });

      setBusy(false);
      onSuccess();
    } catch (err) {
      console.error('Clinic creation error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create clinic');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto mt-24 max-w-sm">
      <h1 className="font-display mb-1 text-center text-xl font-semibold text-[var(--ink)]">
        Create your clinic
      </h1>
      <p className="mb-6 text-center text-sm text-[var(--muted)]">Get started with Thera.Net</p>
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
      </form>
    </div>
  );
}
