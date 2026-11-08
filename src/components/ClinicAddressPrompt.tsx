import { useState } from 'react';
import { btnSecondary, ErrorNote, inputCls } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import { repos } from '@/services';
import type { UUID } from '@/domain/types';

/**
 * Shown on the invoice form when the clinic has no address yet: the address prints on every bill, and it is optional
 * at sign-up. An admin can add it right here (no trip to Settings); anyone else is told who to ask. Renders the
 * prompt only, the caller decides whether a missing address holds up issuing.
 */
export function ClinicAddressPrompt({ clinicId, canEdit }: { clinicId: UUID; canEdit: boolean }) {
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!address.trim()) {
      setError('Type the clinic address first.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const current = await repos.clinics.get(clinicId);
      if (!current) throw new Error('Clinic not found');
      await repos.clinics.put({ ...current, address: address.trim(), updatedAt: new Date().toISOString() });
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  if (!canEdit) {
    return (
      <p role="status" className="rounded-lg bg-[var(--amber-light)] px-3 py-2 text-xs text-[var(--amber-strong)]" data-testid="address-missing">
        The clinic address is not set, so it will be missing from this bill. Ask an admin to add it in Settings → General.
      </p>
    );
  }
  return (
    <div className="space-y-2 rounded-lg bg-[var(--amber-light)] px-3 py-2.5" data-testid="address-missing">
      <p className="text-xs text-[var(--amber-strong)]">The clinic address prints on every bill and has not been added yet.</p>
      <div className="flex gap-2">
        <input
          className={inputCls}
          aria-label="Clinic address"
          placeholder="Street, city"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button type="button" className={btnSecondary} disabled={busy} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      <ErrorNote message={error} />
    </div>
  );
}
