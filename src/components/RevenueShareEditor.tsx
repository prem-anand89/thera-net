import { useEffect, useMemo, useRef, useState } from 'react';
import { visitService } from '@/services';
import { formatINR } from '@/domain/money';
import type { Therapist, Visit, VisitCredit, VisitItem } from '@/domain/types';
import { packageHolder, type CreditShare } from '@/domain/visitLines';
import {
  BILL_BELOW_SHARES,
  addShareRow,
  applyShareEdit,
  initialShares,
  lastEditedBy,
  removeShareRow,
  sharesTotalMismatch,
  sharesAreOutdated,
  type ShareContext,
} from '@/features/visits/shareEdit';
import { btnPrimary, btnSecondary, inputCls, ErrorNote } from '@/components/ui';
import { toFriendlyMessage } from '@/lib/errors';

const rupeesText = (paise: number) => String(Math.round(paise) / 100);
const pctText = (paise: number, bill: number) =>
  bill > 0 ? String(Math.round((paise / bill) * 1000) / 10) : '0';

function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/**
 * Edits how a visit's bill is shared between the therapists who worked on it — internal only, the
 * billed amount, date and invoice never change. Each non-primary therapist has ₹ and % fields (linked,
 * % of the bill); the visit's therapist is the remainder; package money is shown but not editable.
 * The rules live in `shareEdit` / `rebalanceCredits`; this is the form around them.
 */
export function RevenueShareEditor({
  visit,
  items,
  credits,
  therapists,
  splitEnabled = true,
  onClose,
}: {
  visit: Visit;
  items: VisitItem[];
  credits: VisitCredit[];
  therapists: Therapist[];
  /** The clinic's therapist-split setting; decides who holds package money. */
  splitEnabled?: boolean;
  onClose: () => void;
}) {
  const bill = visit.actualBillPaise;
  const ctx: ShareContext = useMemo(
    () => ({ primaryId: visit.therapistId, billPaise: bill, locked: packageHolder(visit, items, splitEnabled) }),
    [visit, items, splitEnabled, bill]
  );
  const [rows, setRows] = useState<CreditShare[]>(() => initialShares(visit, credits, ctx.locked));
  const [draft, setDraft] = useState<{ id: string; field: 'rupees' | 'pct'; text: string } | null>(null);
  // Stored shares that can't be made to add up to the (lowered) bill start with this message and no Save.
  const [error, setError] = useState<string | null>(() =>
    sharesTotalMismatch(initialShares(visit, credits, ctx.locked), bill) ? BILL_BELOW_SHARES : null
  );
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>('input, select')?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  const nameOf = (id: string) => therapists.find((t) => t.id === id)?.name ?? 'Therapist';
  const outdated = sharesAreOutdated(visit, items, credits);
  const byHand = (visit.creditsMode ?? 'auto') === 'manual';
  const editor = lastEditedBy(credits, therapists);
  const total = rows.reduce((s, r) => s + r.amountPaise, 0);
  const primaryRow = rows.find((r) => r.therapistId === visit.therapistId);
  const others = rows.filter((r) => r.therapistId !== visit.therapistId);
  const addable = therapists.filter((t) => t.active && !rows.some((r) => r.therapistId === t.id));
  const invalid = error !== null || total !== bill;

  function edit(id: string, field: 'rupees' | 'pct', text: string) {
    setDraft({ id, field, text });
    const out = applyShareEdit(rows, { therapistId: id, [field]: text }, ctx);
    setRows(out.rows);
    setError(out.error);
  }

  async function run(action: () => Promise<unknown>) {
    setSaveError(null);
    setBusy(true);
    try {
      await action();
      onClose();
    } catch (e) {
      setSaveError(toFriendlyMessage(e));
    } finally {
      setBusy(false);
    }
  }

  function fieldValue(r: CreditShare, field: 'rupees' | 'pct') {
    if (draft && draft.id === r.therapistId && draft.field === field) return draft.text;
    return field === 'rupees' ? rupeesText(r.amountPaise) : pctText(r.amountPaise, bill);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Revenue share"
        className="dialog-panel flex max-h-[90vh] w-full max-w-md flex-col space-y-4 overflow-y-auto rounded-[10px] bg-[var(--surface)] p-5"
      >
        <h2 className="text-sm font-semibold text-[var(--ink)]">Revenue share</h2>
        <p className="text-sm text-[var(--muted)]">
          How this {formatINR(bill)} visit is shared between therapists. Internal only: the bill, date and
          invoice don't change.
        </p>

        <div className="space-y-2 rounded-md bg-[var(--bg,rgba(0,0,0,0.04))] p-3 text-xs text-[var(--ink)]">
          {byHand ? (
            <>
              <p>
                <span className="font-medium">Set by hand.</span> These amounts won't change when you edit the
                services.
              </p>
              {confirmReset ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span>Replace these amounts with the split from the services?</span>
                  <button
                    type="button"
                    className={btnSecondary}
                    disabled={busy}
                    onClick={() => void run(() => visitService.recalculateShares(visit.id))}
                  >
                    Yes, reset
                  </button>
                  <button type="button" className={btnSecondary} onClick={() => setConfirmReset(false)}>
                    Keep mine
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="font-medium text-[var(--teal)] hover:underline"
                  onClick={() => setConfirmReset(true)}
                >
                  Reset to services
                </button>
              )}
            </>
          ) : (
            <p>
              <span className="font-medium">Follows the services.</span> Change who did which service to change
              this. Saving here switches it to set by hand.
            </p>
          )}
        </div>

        {outdated && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border-l-4 border-[var(--teal)] bg-[var(--teal-light)] p-3 text-xs text-[var(--ink)]">
            <span>Services changed. Update shares from services?</span>
            <button
              type="button"
              className={btnSecondary}
              disabled={busy}
              onClick={() => void run(() => visitService.recalculateShares(visit.id))}
            >
              Recalculate from services
            </button>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-baseline justify-between text-sm">
            <span className="font-medium text-[var(--ink)]">
              {nameOf(visit.therapistId)} <span className="text-xs font-normal text-[var(--muted)]">(remainder)</span>
            </span>
            <span className="font-num text-[var(--ink)]">{formatINR(primaryRow?.amountPaise ?? 0)}</span>
          </div>

          {others.map((r) => (
            <div key={r.therapistId} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--ink)]">{nameOf(r.therapistId)}</span>
                {ctx.locked?.therapistId !== r.therapistId && (
                  <button
                    type="button"
                    className="text-xs font-medium text-[var(--teal)] hover:underline"
                    onClick={() => {
                      setRows(removeShareRow(rows, r.therapistId, ctx));
                      setDraft(null);
                      setError(null);
                    }}
                  >
                    Remove
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <label className="flex-1 text-xs text-[var(--muted)]">
                  <span className="mb-0.5 block">Share (₹)</span>
                  <input
                    type="number"
                    min={0}
                    inputMode="decimal"
                    aria-label={`${nameOf(r.therapistId)} share in rupees`}
                    className={inputCls}
                    value={fieldValue(r, 'rupees')}
                    onChange={(e) => edit(r.therapistId, 'rupees', e.target.value)}
                    onBlur={() => !error && setDraft(null)}
                  />
                </label>
                <label className="w-24 text-xs text-[var(--muted)]">
                  <span className="mb-0.5 block">Share (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    inputMode="decimal"
                    aria-label={`${nameOf(r.therapistId)} share in percent`}
                    className={inputCls}
                    value={fieldValue(r, 'pct')}
                    onChange={(e) => edit(r.therapistId, 'pct', e.target.value)}
                    onBlur={() => !error && setDraft(null)}
                  />
                </label>
              </div>
            </div>
          ))}

          {addable.length > 0 && (
            <select
              aria-label="Add a therapist"
              className={inputCls}
              value=""
              onChange={(e) => {
                if (e.target.value) setRows(addShareRow(rows, e.target.value, ctx));
              }}
            >
              <option value="">Add a therapist…</option>
              {addable.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {ctx.locked && ctx.locked.amountPaise > 0 && (
          <p className="text-xs text-[var(--muted)]">
            Package money stays with {nameOf(ctx.locked.therapistId)}: {formatINR(ctx.locked.amountPaise)}
          </p>
        )}
        {editor && (
          <p className="text-xs text-[var(--muted)]">
            Last edited by {editor.name ? `${editor.name} · ` : ''}
            {when(editor.at)}
          </p>
        )}
        {invalid && !error && (
          <p className="text-xs text-[var(--rust)]">The shares must add up to {formatINR(bill)}.</p>
        )}
        <ErrorNote message={error} />
        <ErrorNote message={saveError} />

        <div className="flex justify-end gap-2">
          <button type="button" className={btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={btnPrimary}
            disabled={busy || invalid}
            onClick={() => void run(() => visitService.setShares(visit.id, rows))}
          >
            {busy ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
