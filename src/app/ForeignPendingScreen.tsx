import { btnPrimary, btnSecondary } from '@/components/ui';

/**
 * Shown when someone signs in on a device that still holds another account's
 * unsynced work. Syncing is paused until they choose: the rows would otherwise
 * be pushed with the wrong account's credentials.
 */
export function ForeignPendingScreen({
  count,
  onDiscard,
  onSignOut,
}: {
  count: number;
  onDiscard: () => void;
  onSignOut: () => void;
}) {
  return (
    <div className="mx-auto mt-24 max-w-sm space-y-4 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-6">
      <h1 className="font-display text-lg font-semibold text-[var(--ink)]">Unsynced changes from another account</h1>
      <p className="text-sm text-[var(--ink)]">
        This device still holds {count} unsynced {count === 1 ? 'change' : 'changes'} from a different account. Signing in
        here would discard {count === 1 ? 'it' : 'them'}. To keep {count === 1 ? 'it' : 'them'}, sign out and sign back in
        with the original account so {count === 1 ? 'it' : 'they'} can sync first.
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={btnSecondary} onClick={onSignOut}>
          Sign out
        </button>
        <button type="button" className={btnPrimary} onClick={onDiscard}>
          Discard and continue
        </button>
      </div>
    </div>
  );
}
