import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useClinic } from '@/app/clinicContext';
import { useSession } from '@/app/useSession';
import { repos } from '@/services';
import { toFriendlyMessage } from '@/lib/errors';
import { Field, inputCls, btnPrimary, ErrorNote } from '@/components/ui';

export function TherapistProfileOnboardingPage() {
  const clinic = useClinic();
  const { session } = useSession();
  const navigate = useNavigate();
  const userId = session?.user?.id;
  const therapists = useLiveQuery(
    () => (userId ? repos.therapists.list(clinic.id) : []),
    [clinic.id, userId]
  );
  const therapist = therapists?.find((t) => t.userId === userId);

  const [name, setName] = useState('');
  const [registrationNo, setRegistrationNo] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!therapist) return;
    setName(therapist.name);
    setRegistrationNo(therapist.registrationNo ?? '');
    setPhone(therapist.phone ?? '');
  }, [therapist]);

  async function save() {
    if (!therapist || !userId) return;
    if (!name.trim()) {
      setError('Name on invoices is required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const now = new Date().toISOString();
      await repos.therapists.put({
        ...therapist,
        name: name.trim(),
        registrationNo: registrationNo.trim() || null,
        phone: phone.trim() || null,
        profileConfirmedAt: now,
        updatedAt: now,
      });
      void navigate({ to: '/workspace' });
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!userId) {
    return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  }

  if (therapists && !therapist) {
    return (
      <div className="mx-auto max-w-lg space-y-3">
        <p className="text-sm text-[var(--muted)]">
          Your login isn&apos;t linked to a service roster row yet. Ask an admin to link you under Settings →
          Team, or continue to Workspace.
        </p>
        <button
          type="button"
          className={btnPrimary}
          onClick={() => void navigate({ to: '/workspace' })}
        >
          Go to Workspace
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <div>
        <h1 className="font-display text-xl font-semibold text-[var(--ink)]">How you appear on bills</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          This name prints on invoices. Your account display name can be different — change it anytime from
          the account menu.
        </p>
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 space-y-3">
        <Field label="Name on invoices *">
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Registration no.">
          <input
            className={inputCls}
            placeholder="State council ID (optional)"
            value={registrationNo}
            onChange={(e) => setRegistrationNo(e.target.value)}
          />
        </Field>
        <Field label="Phone">
          <input
            className={inputCls}
            placeholder="+91 …"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </Field>
      </div>
      <ErrorNote message={error} />
      <button type="button" className={btnPrimary} disabled={busy || !therapist} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Go to Workspace'}
      </button>
    </div>
  );
}
