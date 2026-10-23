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

  // Nobody shared with yet and only one other therapist to pick: start with them instead of asking.
  useEffect(() => {
    const free = therapists.filter((t) => t.active && !rows.some((r) => r.therapistId === t.id));
    if (rows.every((r) => r.therapistId === visit.therapistId) && free.length === 1) {
      setRows((cur) => addShareRow(cur, free[0]!.id, ctx));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
        <span className="relative block">
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">
            ₹
          </span>
          <input
            type="number"
            min={0}
            inputMode="decimal"
            aria-label={`${nameOf(id)} share in rupees`}
            {...(id !== visit.therapistId && id === others[0]?.therapistId ? { 'data-first-field': true } : {})}
            className={`${inputCls} ${noSpin} pl-7 text-right`}
            value={fieldValue(r, 'rupees')}
            onChange={(e) => edit(id, 'rupees', e.target.value)}
            onBlur={() => !error && setDraft(null)}
          />
        </span>
        <span className="relative block">
          <input
            type="number"
            min={0}
            max={100}
            inputMode="decimal"
            aria-label={`${nameOf(id)} share in percent`}
            className={`${inputCls} ${noSpin} pr-7 text-right`}
            value={fieldValue(r, 'pct')}
            onChange={(e) => edit(id, 'pct', e.target.value)}
            onBlur={() => !error && setDraft(null)}
          />
          <span aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)]">
            %
          </span>
        </span>
      </>
    );
  }

  const sectionTitle = 'text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]';
  const rowGrid = 'grid grid-cols-[minmax(0,1fr)_6.5rem_5rem] items-center gap-2';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Revenue share"
        className="dialog-panel flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-[10px] bg-[var(--surface)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-[var(--ink)]">Revenue share</h2>
            <p className="mt-0.5 text-xs text-[var(--muted)]">Pay only. The bill doesn&apos;t change.</p>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-wide text-[var(--muted)]">Bill</div>
            <div className="font-num text-base font-semibold text-[var(--ink)]">{formatINR(bill)}</div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto">
          {liveItems.length > 0 && (
            <section className="space-y-2 border-b border-[var(--border)] px-5 py-4">
              <h3 className={sectionTitle}>Services on this visit</h3>
              <ul className="divide-y divide-[var(--border)] text-sm text-[var(--ink)]">
                {liveItems.map((i) => (
                  <li key={i.id} className="flex items-baseline justify-between gap-3 py-1.5 first:pt-0 last:pb-0">
                    <span className="min-w-0">
                      {i.serviceName}
                      <span className="block text-xs text-[var(--muted)]">
                        {i.assistingTherapistId ? nameOf(i.assistingTherapistId) : nameOf(visit.therapistId)}
                      </span>
                    </span>
                    <span className="font-num shrink-0">{formatINR(i.pricePaise)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="space-y-3 px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className={sectionTitle}>Split</h3>
              {byHand ? (
                !confirmReset && (
                  <span className="flex items-center gap-2 text-xs">
                    <span className="rounded-full bg-[var(--amber-light,rgba(184,137,43,0.15))] px-2 py-0.5 font-medium text-[var(--ink)]">
                      Set by hand
                    </span>
                    <button
                      type="button"
                      className="font-medium text-[var(--teal)] hover:underline"
                      onClick={() => setConfirmReset(true)}
                    >
                      Reset to services
                    </button>
                  </span>
                )
              ) : (
                <span
                  className="rounded-full bg-[var(--teal-light)] px-2 py-0.5 text-xs font-medium text-[var(--ink)]"
                  title="Based on who did each service. Saving your changes makes it set by hand."
                >
                  Automatic
                </span>
              )}
            </div>

            {byHand && confirmReset && (
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-[var(--paper)] p-2.5 text-xs text-[var(--ink)]">
                <span className="flex-1">Use the split from the services instead?</span>
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
            )}

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

            <ShareBar
              bill={bill}
              parts={[primaryRow, ...others]
                .filter((r): r is CreditShare => Boolean(r))
                .map((r) => ({ id: r.therapistId, name: nameOf(r.therapistId), paise: r.amountPaise }))}
            />

            <div className="space-y-2">
              <div className={`${rowGrid} text-[11px] uppercase tracking-wide text-[var(--muted)]`}>
                <span>Therapist</span>
                <span className="text-right">Amount</span>
                <span className="text-right">Share</span>
              </div>

              <div className={rowGrid}>
                <span className="min-w-0 text-sm font-medium text-[var(--ink)]">
                  {nameOf(visit.therapistId)}
                  <span className="block text-xs font-normal text-[var(--muted)]">
                    {primaryEditable ? 'Takes the rest' : 'Remainder'}
                  </span>
                </span>
                {primaryEditable && primaryRow ? (
                  amountFields(primaryRow, visit.therapistId)
                ) : (
                  <>
                    <span className="font-num text-right text-sm text-[var(--ink)]">
                      {formatINR(primaryRow?.amountPaise ?? 0)}
                    </span>
                    <span className="font-num text-right text-sm text-[var(--muted)]">
                      {pctText(primaryRow?.amountPaise ?? 0, bill)}%
                    </span>
                  </>
                )}
              </div>

              {others.map((r) => (
                <div key={r.therapistId} className={rowGrid}>
                  <span className="min-w-0 text-sm font-medium text-[var(--ink)]">
                    {nameOf(r.therapistId)}
                    {ctx.locked?.therapistId !== r.therapistId && (
                      <button
                        type="button"
                        className="block text-xs font-medium text-[var(--teal)] hover:underline"
                        onClick={() => {
                          setRows(removeShareRow(rows, r.therapistId, ctx));
                          setDraft(null);
                          setError(null);
                        }}
                      >
                        Remove
                      </button>
                    )}
                  </span>
                  {amountFields(r, r.therapistId)}
                </div>
              ))}
            </div>

            {addable.length > 0 &&
              (adding || others.length === 0 ? (
                <select
                  aria-label="Add a therapist"
                  className={inputCls}
                  value=""
                  autoFocus={others.length > 0}
                  onChange={(e) => {
                    if (e.target.value) setRows(addShareRow(rows, e.target.value, ctx));
                    setAdding(false);
                  }}
                  onBlur={() => setAdding(false)}
                >
                  <option value="">{others.length === 0 ? 'Share with…' : 'Choose a therapist…'}</option>
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

            {ctx.locked && ctx.locked.amountPaise > 0 && (
              <p className="text-xs text-[var(--muted)]">
                Package money stays with {nameOf(ctx.locked.therapistId)}: {formatINR(ctx.locked.amountPaise)}
              </p>
            )}
            {invalid && !error && (
              <p className="text-xs text-[var(--rust)]">The shares must add up to {formatINR(bill)}.</p>
            )}
            <ErrorNote message={error} />
            <ErrorNote message={saveError} />
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--paper)] px-5 py-3">
          <p className="text-xs text-[var(--muted)]">
            {editor ? (
              <>
                Last edited by {editor.name ? `${editor.name} · ` : ''}
                {when(editor.at)}
              </>
            ) : null}
          </p>
          <div className="ml-auto flex gap-2">
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
        </footer>
      </div>
    </div>
  );
}
