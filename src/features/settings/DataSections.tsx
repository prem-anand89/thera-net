import { useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { backupService } from '@/services';
import type { BackupBundle, RestoreSummary } from '@/services/backupService';
import { useClinic } from '@/app/clinicContext';
import { getSupabase } from '@/lib/supabase';
import { db } from '@/lib/db';
import { btnPrimary, btnSecondary, ErrorNote, SectionCard, ConfirmDialog } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';
import { lastBackupMetaKey } from '@/domain/setupGuide';

export function HistoricalData() {
  return (
    <SectionCard id="settings-card-account-historical" title="Historical data">
      <p className="mb-3 text-xs text-[var(--muted)]">
        One-time import of visits logged before go-live in the Excel ledger.
      </p>
      <Link to="/settings/import-visits" className="text-sm text-[var(--teal)] hover:underline">
        Import historical visits from Excel →
      </Link>
    </SectionCard>
  );
}

export function DataBackup() {
  const clinic = useClinic();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const [pendingRestore, setPendingRestore] = useState<BackupBundle | null>(null);

  async function exportNow() {
    setError(null);
    setBusy(true);
    try {
      await backupService.downloadBackup(clinic.id, clinic.name);
      await db.meta.put({ key: lastBackupMetaKey(clinic.id), value: new Date().toISOString() });
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setError(null);
    setSummary(null);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as BackupBundle;
      setPendingRestore(bundle);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function confirmRestore() {
    if (!pendingRestore) return;
    const bundle = pendingRestore;
    setPendingRestore(null);
    setBusy(true);
    try {
      const result = await backupService.restoreBundle(bundle, clinic.id);
      setSummary(result);
    } catch (e) {
      setError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard id="settings-card-account-backup" title="Data backup">
      <p className="mb-3 text-xs text-[var(--muted)]">
        Download a full snapshot of this clinic's data (patients, visits, invoices, payments,
        catalog, therapists) any time — a safety net before a wipe, a device change, or just as a
        habit. Restoring writes back through the same sync path as normal use, so restored data
        reaches the server too.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btnSecondary}
          disabled={busy}
          onClick={() => void exportNow()}
        >
          {busy ? 'Working…' : 'Export backup'}
        </button>
        <button
          type="button"
          className={btnSecondary}
          disabled={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          Import backup…
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importFile(file);
          }}
        />
      </div>
      {summary && (
        <p className="mt-3 text-sm text-[var(--moss)]">
          Restored {summary.patients} patients, {summary.visits} visits ({summary.visitItems} service lines, {summary.visitCredits} revenue shares), {summary.invoices}{' '}
          invoices, {summary.payments + summary.invoicePayments} payment records, {summary.catalog}{' '}
          catalog items, {summary.therapists} therapists, and {summary.settlements} settlements.
        </p>
      )}
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>

      <ConfirmDialog
        open={pendingRestore !== null}
        title="Restore backup?"
        message={`Restore this backup (exported ${pendingRestore?.exportedAt?.slice(0, 10) ?? 'unknown date'})?\n\nThis writes patients, visits, invoices, payments, and settlements back into this clinic. Existing records with the same ID are overwritten; nothing else is deleted.`}
        confirmLabel="Restore"
        onCancel={() => setPendingRestore(null)}
        onConfirm={() => void confirmRestore()}
      />
    </SectionCard>
  );
}

export function DangerZone() {
  const clinic = useClinic();
  const clinics = useLiveQuery(() => db.clinics.toArray(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [confirmingDeleteClinic, setConfirmingDeleteClinic] = useState(false);
  const [wipeResult, setWipeResult] = useState<{
    patients: number;
    visits: number;
    invoices: number;
  } | null>(null);

  async function doResetLocalCache() {
    setConfirmingReset(false);
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

  function wipeAll() {
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('Wiping needs a connection — try again when online.');
      return;
    }
    setConfirmingWipe(true);
  }

  async function doWipeAll() {
    setConfirmingWipe(false);
    const supabase = getSupabase();
    if (!supabase) return;
    setBusy(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('admin_wipe_clinic_data', {
        p_clinic_id: clinic.id,
      });
      if (rpcError) throw new Error(rpcError.message);
      setWipeResult(data as { patients: number; visits: number; invoices: number });
    } catch (e) {
      setError(toFriendlyMessage(e));
      setBusy(false);
    }
  }

  async function finishWipeReload() {
    await db.delete();
    location.reload();
  }

  function deleteClinic() {
    setError(null);
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) {
      setError('Deleting a clinic needs a connection — try again when online.');
      return;
    }
    setConfirmingDeleteClinic(true);
  }

  async function doDeleteClinic() {
    setConfirmingDeleteClinic(false);
    const supabase = getSupabase();
    if (!supabase) return;
    setBusy(true);
    try {
      const { error: rpcError } = await supabase.rpc('admin_delete_clinic', {
        p_clinic_id: clinic.id,
      });
      if (rpcError) throw new Error(rpcError.message);
      await db.delete();
      location.reload();
    } catch (e) {
      setError(toFriendlyMessage(e));
      setBusy(false);
    }
  }

  const otherClinicCount = (clinics ?? []).filter((c) => c.id !== clinic.id).length;

  return (
    <details id="settings-card-account-danger" className="group scroll-mt-24 rounded-2xl border border-[var(--rust-light)] bg-[var(--surface)] open:pb-4">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-[var(--rust)] [&::-webkit-details-marker]:hidden">
        Danger zone
        <span className="text-xs font-medium text-[var(--muted)] group-open:hidden">Show</span>
        <span className="hidden text-xs font-medium text-[var(--muted)] group-open:inline">Hide</span>
      </summary>
      <div className="px-4">
      <p className="mb-3 text-xs text-[var(--muted)]">
        For test-data cleanup and troubleshooting. Wiping is admin-only and enforced by the server.
      </p>
      {wipeResult && (
        <div className="mb-3 rounded-md border border-[var(--moss)] bg-[var(--moss-light)] px-3 py-2.5 text-sm text-[var(--moss-strong)]">
          <p>
            Wiped {wipeResult.patients} patients, {wipeResult.visits} visits, and{' '}
            {wipeResult.invoices} invoices. The app needs to reload to show a clean slate.
          </p>
          <p className="mt-1 text-xs">
            On any OTHER device that was already signed in, use "Reset local cache" once there.
          </p>
          <button
            type="button"
            className={`${btnPrimary} mt-2.5`}
            onClick={() => void finishWipeReload()}
          >
            Reload now
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={btnSecondary}
          disabled={busy}
          onClick={() => setConfirmingReset(true)}
        >
          {busy ? 'Working…' : 'Reset local cache on this device'}
        </button>
        <button
          type="button"
          className="rounded-md border border-[var(--rust)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--rust)] hover:bg-[var(--rust-light)] disabled:opacity-50"
          disabled={busy}
          onClick={wipeAll}
        >
          {busy ? 'Wiping…' : 'Wipe ALL clinic data…'}
        </button>
        <button
          type="button"
          className="rounded-md border border-[var(--rust)] bg-[var(--rust-light)] px-4 py-2 text-sm font-medium text-[var(--rust)] hover:bg-[var(--surface)] disabled:opacity-50"
          disabled={busy}
          onClick={deleteClinic}
        >
          {busy ? 'Working…' : 'Delete clinic entirely…'}
        </button>
      </div>
      <p className="mt-2 text-xs text-[var(--muted)]">
        <strong>Wipe</strong> removes patients, visits, and invoices but keeps this clinic, its
        catalog, therapists, and team logins. <strong>Delete clinic</strong> removes the whole
        clinic permanently — including team access, catalog, and all data. Logo files in storage may
        need manual cleanup.
        {otherClinicCount > 0
          ? ` You have ${otherClinicCount} other clinic${otherClinicCount === 1 ? '' : 's'} — after delete you'll switch to another.`
          : " This is your only clinic — you'll set up a new one afterward."}
      </p>
      <div className="mt-2">
        <ErrorNote message={error} />
      </div>

      <ConfirmDialog
        open={confirmingReset}
        title="Reset local cache?"
        message="Clear this device's local copy of the data?\n\nNothing on the server is affected — the app reloads and downloads everything fresh. Use this after a wipe, or if this device is showing stale data."
        confirmLabel="Clear local data"
        onCancel={() => setConfirmingReset(false)}
        onConfirm={() => void doResetLocalCache()}
      />
      <ConfirmDialog
        open={confirmingWipe}
        title="Wipe ALL clinic data?"
        message={`This permanently deletes ALL patients, visits, invoices, payments and settlements for this clinic, and resets invoice numbering to 0001. The catalog, therapists, and logins are kept.\n\nThis cannot be undone.`}
        confirmLabel="Wipe clinic data"
        destructive
        typeToConfirm={{
          placeholder: `Type "${clinic.name}" to confirm`,
          isMatch: (typed) => typed.trim() === clinic.name,
        }}
        onCancel={() => setConfirmingWipe(false)}
        onConfirm={() => void doWipeAll()}
      />
      <ConfirmDialog
        open={confirmingDeleteClinic}
        title="Delete this clinic permanently?"
        message={`This deletes "${clinic.name}" and everything in it — all patients, visits, invoices, catalog, therapists, and team logins. This cannot be undone.`}
        confirmLabel="Delete clinic"
        destructive
        typeToConfirm={{
          placeholder: `Type "${clinic.name}" to confirm`,
          isMatch: (typed) => typed.trim() === clinic.name,
        }}
        onCancel={() => setConfirmingDeleteClinic(false)}
        onConfirm={() => void doDeleteClinic()}
      />
      </div>
    </details>
  );
}
