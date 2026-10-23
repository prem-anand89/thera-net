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

const noSpin =
  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';
const BAR_COLORS = ['var(--teal)', '#c65f2f', '#b8892b', '#6b6fb5', '#7a8f4a'];

/** A stacked bar of each therapist's share of the bill. */
function ShareBar({ parts, bill }: { parts: { id: string; name: string; paise: number }[]; bill: number }) {
  if (bill <= 0) return null;
  return (
    <div
      className="flex h-2.5 w-full overflow-hidden rounded-full bg-[var(--border)]"
      role="img"
      aria-label={parts.map((p) => `${p.name} ${Math.round((p.paise / bill) * 100)}%`).join(', ')}
    >
      {parts.map((p, i) =>
        p.paise > 0 ? (
          <span
            key={p.id}
            title={`${p.name} ${formatINR(p.paise)}`}
            style={{ width: `${(p.paise / bill) * 100}%`, background: BAR_COLORS[i % BAR_COLORS.length] }}
          />
        ) : null
      )}
    </div>
  );
}

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
    dialogRef.current?.querySelector<HTMLElement>('[data-first-field]')?.focus();
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
  const [adding, setAdding] = useState(false);

  const nameOf = (id: string) => therapists.find((t) => t.id === id)?.name ?? 'Therapist';
  const outdated = sharesAreOutdated(visit, items, credits);
  const liveItems = items.filter((i) => !i.deleted).sort((a, b) => a.position - b.position);
  const byHand = (visit.creditsMode ?? 'auto') === 'manual';
  const editor = lastEditedBy(credits, therapists);
  const total = rows.reduce((s, r) => s + r.amountPaise, 0);
  const primaryRow = rows.find((r) => r.therapistId === visit.therapistId);
  const others = rows.filter((r) => r.therapistId !== visit.therapistId);
  const addable = therapists.filter((t) => t.active && !rows.some((r) => r.therapistId === t.id));
  const invalid = error !== null || total !== bill;

  // With one assistant and no package money, the primary's own field can be typed in: the assistant takes the rest.
  const primaryEditable = others.length === 1 && !ctx.locked;

  function edit(id: string, field: 'rupees' | 'pct', text: string) {
    setDraft({ id, field, text });
    let target = id;
    let value = text;
    if (id === visit.therapistId && primaryEditable) {
      target = others[0]!.therapistId;
      const n = Number(text);
      if (text.trim() === '' || !Number.isFinite(n)) {
        value = '';
      } else if (field === 'rupees') {
        value = String(Math.max(0, Math.round((bill - n * 100)) / 100));
      } else {
        value = String(Math.max(0, Math.round((100 - n) * 10) / 10));
      }
    }
    const out = applyShareEdit(rows, { therapistId: target, [field]: value }, ctx);
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

  function amountFields(r: CreditShare, id: string) {
    return (
      <>
        <label className="flex-1 text-xs text-[var(--muted)]">
          <span className="mb-0.5 block">Share (₹)</span>
          <span className="relative block">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">
              ₹
            </span>
            <input
              type="number"
              min={0}
              inputMode="decimal"
              aria-label={`${nameOf(id)} share in rupees`}
              {...(id !== visit.therapistId && id === others[0]?.therapistId ? { 'data-first-field': true } : {})}
              className={`${inputCls} ${noSpin} pl-7`}
              value={fieldValue(r, 'rupees')}
              onChange={(e) => edit(id, 'rupees', e.target.value)}
              onBlur={() => !error && setDraft(null)}
            />
          </span>
        </label>
        <label className="w-24 text-xs text-[var(--muted)]">
          <span className="mb-0.5 block">Share (%)</span>
          <span className="relative block">
            <input
              type="number"
              min={0}
              max={100}
              inputMode="decimal"
              aria-label={`${nameOf(id)} share in percent`}
              className={`${inputCls} ${noSpin} pr-7`}
              value={fieldValue(r, 'pct')}
              onChange={(e) => edit(id, 'pct', e.target.value)}
              onBlur={() => !error && setDraft(null)}
            />
            <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2">
              %
            </span>
          </span>
        </label>
      </>
    );
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

        {liveItems.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-[var(--muted)]">Services on this visit</p>
            <ul className="space-y-0.5 text-xs text-[var(--ink)]">
              {liveItems.map((i) => (
                <li key={i.id} className="flex justify-between gap-2">
                  <span>
                    {i.serviceName}
                    <span className="text-[var(--muted)]">
                      {' '}
                      · {i.assistingTherapistId ? nameOf(i.assistingTherapistId) : nameOf(visit.therapistId)}
                    </span>
                  </span>
                  <span className="font-num">{formatINR(i.pricePaise)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ShareBar
          bill={bill}
          parts={[primaryRow, ...others]
            .filter((r): r is CreditShare => Boolean(r))
            .map((r) => ({ id: r.therapistId, name: nameOf(r.therapistId), paise: r.amountPaise }))}
        />

        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-[var(--ink)]">
                {nameOf(visit.therapistId)}{' '}
                <span className="text-xs font-normal text-[var(--muted)]">
                  {primaryEditable ? '(takes the rest)' : '(remainder)'}
                </span>
              </span>
              {!primaryEditable && (
                <span className="font-num text-[var(--ink)]">{formatINR(primaryRow?.amountPaise ?? 0)}</span>
              )}
            </div>
            {primaryEditable && primaryRow && (
              <div className="flex gap-2">
                {amountFields(primaryRow, visit.therapistId)}
              </div>
            )}
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
              <div className="flex gap-2">{amountFields(r, r.therapistId)}</div>
            </div>
          ))}

          {addable.length > 0 &&
            (adding ? (
              <select
                aria-label="Add a therapist"
                className={inputCls}
                value=""
                autoFocus
                onChange={(e) => {
                  if (e.target.value) setRows(addShareRow(rows, e.target.value, ctx));
                  setAdding(false);
                }}
                onBlur={() => setAdding(false)}
              >
                <option value="">Choose a therapist…</option>
                {addable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              <button
                type="button"
                className="text-xs font-medium text-[var(--teal)] hover:underline"
                onClick={() => setAdding(true)}
              >
                + Add another therapist
              </button>
            ))}
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
