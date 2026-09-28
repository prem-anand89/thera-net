import { useMemo, useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { useClinic } from '@/app/clinicContext';
import { formatINR } from '@/domain/money';
import { formatDateDMY, currentWeekRange } from '@/domain/fiscalYear';
import { th, td, tdNum, thNum, SectionCard, Pill } from '@/components/ui';

// Local Y/M/D components
const toIsoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function DaybookPage() {
  const clinic = useClinic();
  const todayIso = useMemo(() => toIsoDate(new Date()), []);
  const [from, setFrom] = useState(todayIso);
  const [to, setTo] = useState(todayIso);
  const [preset, setPreset] = useState<'today' | 'yesterday' | 'week' | 'month' | 'custom'>('today');

  const yesterdayIso = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return toIsoDate(d);
  }, []);

  const weekRange = useMemo(() => currentWeekRange(new Date()), []);

  const monthRange = useMemo(() => {
    const now = new Date();
    const mFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    return { from: mFrom, to: toIsoDate(now) };
  }, []);

  useEffect(() => {
    if (preset === 'today') {
      setFrom(todayIso);
      setTo(todayIso);
    } else if (preset === 'yesterday') {
      setFrom(yesterdayIso);
      setTo(yesterdayIso);
    } else if (preset === 'week') {
      setFrom(weekRange.from);
      setTo(weekRange.to);
    } else if (preset === 'month') {
      setFrom(monthRange.from);
      setTo(monthRange.to);
    }
  }, [preset, todayIso, yesterdayIso, weekRange, monthRange]);
  
  const data = useLiveQuery(async () => {
    const payments = await db.payments.where('clinicId').equals(clinic.id)
      .filter(p => !!p.receivedDate && p.receivedDate.slice(0, 10) >= from && p.receivedDate.slice(0, 10) <= to)
      .toArray();

    const advances = await db.patient_advances.where('clinicId').equals(clinic.id)
      .filter(a => !a.deleted && !!a.receivedDate && a.receivedDate.slice(0, 10) >= from && a.receivedDate.slice(0, 10) <= to)
      .toArray();

    const visitIds = [...new Set(payments.map(p => p.visitId).filter(Boolean))];
    const visits = visitIds.length > 0 
      ? await db.visits.where('id').anyOf(visitIds).toArray() 
      : [];

    const patientIds = [...new Set([
      ...advances.map(a => a.patientId),
      ...visits.map(v => v.patientId)
    ].filter(Boolean))];
    
    const patients = patientIds.length > 0
      ? await db.patients.where('id').anyOf(patientIds).toArray()
      : [];

    return { payments, advances, visits, patients };
  }, [clinic.id, from, to], { payments: [], advances: [], visits: [], patients: [] });

  const { cash, upi, card, other, total, transactions } = useMemo(() => {
    let cash = 0, upi = 0, card = 0, other = 0;
    const transactions: { id: string; date: string; patientName: string; type: string; method: string; amount: number; notes: string }[] = [];

    const patientNameById = new Map((data.patients ?? []).map((p) => [p.id, p.name]));
    const visitById = new Map((data.visits ?? []).map((v) => [v.id, v]));

    // 1. Regular Payments
    for (const p of data.payments ?? []) {
        if (p.advanceId) continue;
        const amt = p.amountPaise;
        if (p.method === 'cash') cash += amt;
        else if (p.method === 'upi') upi += amt;
        else if (p.method === 'card') card += amt;
        else other += amt;

        const visit = visitById.get(p.visitId);
        const pId = visit?.patientId;
        const pName = pId ? (patientNameById.get(pId) ?? 'Unknown') : 'Unknown';
        
        let note = p.notes ?? '';
        
        if (visit && visit.adjustmentPaise < 0) {
          const adjReason = visit.adjustmentReason || 'no reason';
          const discountStr = `Included ${formatINR(Math.abs(visit.adjustmentPaise))} discount (${adjReason})`;
          note = note ? `${discountStr}. ${note}` : discountStr;
        } else if (visit && visit.adjustmentPaise > 0) {
          const adjReason = visit.adjustmentReason || 'no reason';
          const topUpStr = `Included ${formatINR(visit.adjustmentPaise)} top-up (${adjReason})`;
          note = note ? `${topUpStr}. ${note}` : topUpStr;
        }

        transactions.push({
          id: p.id,
          date: p.receivedDate,
          patientName: pName,
          type: 'Bill Payment',
          method: p.method,
          amount: amt,
          notes: note
        });
    }

    // 2. New Advances collected
    for (const a of data.advances ?? []) {
        const amt = a.amountPaise;
        if (a.method === 'cash') cash += amt;
        else if (a.method === 'upi') upi += amt;
        else if (a.method === 'card') card += amt;
        else other += amt;

        const pName = patientNameById.get(a.patientId) ?? 'Unknown';
        transactions.push({
          id: a.id,
          date: a.receivedDate,
          patientName: pName,
          type: 'Advance Deposit',
          method: a.method,
          amount: amt,
          notes: a.notes ?? ''
        });
    }



    transactions.sort((a, b) => b.date.localeCompare(a.date));

    return { cash, upi, card, other, total: cash + upi + card + other, transactions };
  }, [data]);

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex max-w-full flex-wrap gap-1 rounded-lg border border-[var(--border)] bg-[var(--paper)] p-1">
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              preset === 'today'
                ? 'bg-[var(--teal)] text-white'
                : 'text-[var(--muted)] hover:bg-[var(--surface)]'
            }`}
            onClick={() => setPreset('today')}
          >
            Today
          </button>
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              preset === 'yesterday'
                ? 'bg-[var(--teal)] text-white'
                : 'text-[var(--muted)] hover:bg-[var(--surface)]'
            }`}
            onClick={() => setPreset('yesterday')}
          >
            Yesterday
          </button>
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              preset === 'week'
                ? 'bg-[var(--teal)] text-white'
                : 'text-[var(--muted)] hover:bg-[var(--surface)]'
            }`}
            onClick={() => setPreset('week')}
          >
            This week
          </button>
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              preset === 'month'
                ? 'bg-[var(--teal)] text-white'
                : 'text-[var(--muted)] hover:bg-[var(--surface)]'
            }`}
            onClick={() => setPreset('month')}
          >
            This month
          </button>
          <button
            type="button"
            className={`rounded-md px-2.5 py-1 text-xs font-medium ${
              preset === 'custom'
                ? 'bg-[var(--teal)] text-white'
                : 'text-[var(--muted)] hover:bg-[var(--surface)]'
            }`}
            onClick={() => setPreset('custom')}
          >
            Custom date
          </button>
        </div>

        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <span className="text-[var(--muted)] text-sm">to</span>
            <input
              type="date"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        )}
      </div>

      <SectionCard title={`Collections for ${from === to ? formatDateDMY(from) : `${formatDateDMY(from)} – ${formatDateDMY(to)}`}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className={th}>Payment Method</th>
                <th className={thNum}>Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--border)] group hover:bg-[var(--paper)]">
                <td className={td}>Cash</td>
                <td className={tdNum}>{formatINR(cash)}</td>
              </tr>
              <tr className="border-b border-[var(--border)] group hover:bg-[var(--paper)]">
                <td className={td}>UPI</td>
                <td className={tdNum}>{formatINR(upi)}</td>
              </tr>
              <tr className="border-b border-[var(--border)] group hover:bg-[var(--paper)]">
                <td className={td}>Card</td>
                <td className={tdNum}>{formatINR(card)}</td>
              </tr>
              {other > 0 && (
                <tr className="border-b border-[var(--border)] group hover:bg-[var(--paper)]">
                  <td className={td}>Other (Bank/Cheque)</td>
                  <td className={tdNum}>{formatINR(other)}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="py-3 px-3 text-right font-semibold text-[var(--ink)]">Total Collected</td>
                <td className="py-3 px-3 text-right text-base font-bold text-[var(--ink)]">{formatINR(total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </SectionCard>

      <SectionCard title="Transaction Log">
        <div className="overflow-x-auto">
          <table className="hidden tab:table w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className={th}>Date</th>
                <th className={th}>Patient</th>
                <th className={th}>Type</th>
                <th className={th}>Mode</th>
                <th className={thNum}>Amount</th>
                <th className={th}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((t) => (
                <tr key={t.id} className="border-b border-[var(--border)] group hover:bg-[var(--paper)]">
                  <td className={td}>{formatDateDMY(t.date)}</td>
                  <td className={`${td} font-medium`}>{t.patientName}</td>
                  <td className={td}>
                    <Pill tone={t.type === 'Advance Deposit' ? 'amber' : t.type === 'Discount' ? 'rust' : t.type === 'Price Top-up' ? 'teal' : 'green'}>
                      {t.type}
                    </Pill>
                  </td>
                  <td className={td}>{t.method === '—' ? '—' : t.method.toUpperCase()}</td>
                  <td className={tdNum}>{formatINR(t.amount)}</td>
                  <td className={`${td} text-[var(--muted)] whitespace-normal break-words max-w-[250px] leading-snug`} title={t.notes}>{t.notes || '—'}</td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[var(--muted)]">No transactions in this period.</td>
                </tr>
              )}
            </tbody>
          </table>
          
          <div className="tab:hidden flex flex-col space-y-3">
            {transactions.length === 0 && (
              <div className="py-8 text-center text-[var(--muted)] text-sm">No transactions in this period.</div>
            )}
            {transactions.map((t) => (
              <div key={t.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3.5 shadow-sm text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-display font-medium text-[var(--ink)]">{t.patientName}</div>
                  <div className="font-num font-bold text-[var(--ink)]">{formatINR(t.amount)}</div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--muted)]">
                  <Pill tone="slate">{formatDateDMY(t.date)}</Pill>
                  <Pill tone="slate">{t.method === '—' ? '—' : t.method.toUpperCase()}</Pill>
                  <Pill tone={t.type === 'Advance Deposit' ? 'amber' : t.type === 'Discount' ? 'rust' : t.type === 'Price Top-up' ? 'teal' : 'green'}>
                    {t.type}
                  </Pill>
                </div>
                {t.notes && (
                  <div className="mt-2 text-xs text-[var(--muted)] italic bg-[var(--paper)] p-2 rounded border border-[var(--border)]">
                    {t.notes}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
