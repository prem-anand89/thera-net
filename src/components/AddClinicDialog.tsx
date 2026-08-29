import { CreateClinicForm } from '@/features/settings/CreateClinicForm';

/**
 * Modal shell around `CreateClinicForm`'s `'dialog'` variant — the second,
 * in-app entry point to `create_clinic_with_admin` alongside the
 * zero-clinic full-page one in `Shell.tsx`. `CreateClinicForm` already
 * sets the new clinic active and caches it locally on success, so closing
 * this dialog is all that's left to do here.
 */
export function AddClinicDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-[var(--ink)]/40 p-3 sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-clinic-title"
        className="w-full max-w-sm space-y-4 rounded-2xl bg-[var(--surface)] p-4 sm:p-5"
      >
        <div>
          <h2 id="add-clinic-title" className="text-sm font-semibold text-[var(--ink)]">
            Add another clinic
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            Starts fresh, with its own plan, roster, and data — you'll be switched to it once
            created.
          </p>
        </div>
        <CreateClinicForm variant="dialog" onSuccess={onCreated} />
        <div className="flex justify-end">
          <button
            type="button"
            className="text-xs text-[var(--muted)] hover:underline"
            onClick={onClose}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
