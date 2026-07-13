import { useMemo } from 'react';
import { Link, useSearch } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { repos, reportService } from '@/services';
import { useClinic } from '@/app/clinicContext';
import { publicLogoUrl } from '@/lib/supabase';
import { formatINR } from '@/domain/money';
import { fiscalYearOf, monthDateRange, monthName, formatDateDMY } from '@/domain/fiscalYear';
import { clinicBillingConfig, clinicShareLabels } from '@/domain/types';
import { btnPrimary, btnSecondary } from '@/components/ui';
import { MonthlyReportTable } from '@/components/MonthlyReportTable';

export function MonthlyLedgerPrintPage() {
  const clinic = useClinic();
  const { year, month } = useSearch({ strict: false }) as { year: number; month: number };
  const labels = clinicShareLabels(clinic);
  const { hospitalSplit } = clinicBillingConfig(clinic);
  const period = { year, month };
  const fy = fiscalYearOf(new Date(period.year, period.month - 1, 1), clinic.fyStartMonth);

  const visits = useLiveQuery(() => {
    const { from, to } = monthDateRange(period);
    return repos.visits.list({ clinicId: clinic.id, from, to });
  }, [clinic.id, period.year, period.month]);
  const patients = useLiveQuery(() => repos.patients.list(clinic.id), [clinic.id]);
  const therapists = useLiveQuery(() => repos.therapists.list(clinic.id, true), [clinic.id]);
  const catalog = useLiveQuery(() => repos.catalog.list(clinic.id, true), [clinic.id]);
  const report = useLiveQuery(() => reportService.monthly(clinic.id, period), [clinic.id, period.year, period.month]);

  const patientById = useMemo(() => new Map((patients ?? []).map((p) => [p.id, p])), [patients]);
  const therapistName = useMemo(
    () => new Map((therapists ?? []).map((t) => [t.id, t.name])),
    [therapists]
  );
  const serviceName = useMemo(() => new Map((catalog ?? []).map((c) => [c.id, c.name])), [catalog]);

  const sortedVisits = useMemo(
    () => [...(visits ?? [])].sort((a, b) => a.visitDate.localeCompare(b.visitDate)),
    [visits]
  );

  const logoUrl = useMemo(() => publicLogoUrl(clinic.logoPath), [clinic.logoPath]);
  const partnerLogoUrl = useMemo(
    () => publicLogoUrl(clinic.partnerHospitalLogoPath),
    [clinic.partnerHospitalLogoPath]
  );

  return (
    <div className="min-h-screen bg-[var(--paper)] print:bg-[var(--surface)]">
      <style>{`@page { size: A4 landscape; margin: 12mm; }`}</style>

      <div className="no-print mx-auto flex max-w-6xl items-center gap-2 px-4 py-3">
        <Link to="/reports" className={btnSecondary}>
          ← Back
        </Link>
        <button className={`${btnPrimary} ml-auto`} onClick={() => window.print()}>
          Print / Save PDF
        </button>
      </div>

      <div className="mx-auto max-w-6xl bg-[var(--surface)] p-8 print:max-w-none print:p-0">
        {/* Letterhead */}
        <header className="flex items-start justify-between border-b border-[var(--border)] pb-4">
          <div className="flex items-center gap-3">
            {logoUrl && <img src={logoUrl} alt="" className="h-14 w-auto object-contain" />}
            <div>
              <h1 className="font-display text-xl font-bold text-[var(--ink)]">{clinic.name}</h1>
              {clinic.address && <p className="text-xs text-[var(--muted)]">{clinic.address}</p>}
              <p className="text-xs text-[var(--muted)]">
                {[clinic.phone, clinic.email].filter(Boolean).join(' · ')}
              </p>
              {clinic.gstNo && <p className="text-xs text-[var(--muted)]">GSTIN: {clinic.gstNo}</p>}
            </div>
          </div>
          {clinic.partnerHospitalName && (
            <div className="flex items-center gap-2 text-right">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">In partnership with</p>
                <p className="text-sm font-medium text-[var(--ink)]">{clinic.partnerHospitalName}</p>
              </div>
              {partnerLogoUrl && (
                <img src={partnerLogoUrl} alt="" className="h-10 w-auto object-contain" />
              )}
            </div>
          )}
        </header>

        <div className="mt-4 flex items-baseline justify-between">
          <h2 className="text-lg font-bold text-[var(--ink)]">Monthly Visit Ledger</h2>
          <p className="text-sm text-[var(--muted)]">
            {monthName(period.month)} {period.year} · FY {fy.label}
          </p>
        </div>

        {/* Per-visit table */}
        <table className="mt-4 w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] text-left uppercase tracking-wide text-[var(--muted)]">
              <th className="py-1.5 pr-2">SN</th>
              <th className="py-1.5 pr-2">Date</th>
              <th className="py-1.5 pr-2">Patient</th>
              <th className="py-1.5 pr-2">Patient ID</th>
              <th className="py-1.5 pr-2">Age/Sex</th>
              <th className="py-1.5 pr-2">Condition</th>
              <th className="py-1.5 pr-2">Therapist</th>
              <th className="py-1.5 pr-2">Service</th>
              <th className="py-1.5 text-right">Bill Amount</th>
            </tr>
          </thead>
          <tbody>
            {sortedVisits.map((v, i) => {
              const p = patientById.get(v.patientId);
              return (
                <tr key={v.id} className="border-b border-[var(--border)]">
                  <td className="py-1 pr-2 text-[var(--muted)]">{i + 1}</td>
                  <td className="py-1 pr-2">{formatDateDMY(v.visitDate)}</td>
                  <td className="font-display py-1 pr-2 font-medium text-[var(--ink)]">{p?.name ?? '—'}</td>
                  <td className="py-1 pr-2">{p?.mrno ?? '—'}</td>
                  <td className="py-1 pr-2">
                    {p?.age ?? '—'} / {p?.sex ?? '—'}
                  </td>
                  <td className="py-1 pr-2">{v.condition ?? '—'}</td>
                  <td className="py-1 pr-2">{therapistName.get(v.therapistId) ?? '—'}</td>
                  <td className="py-1 pr-2">
                    {serviceName.get(v.serviceCatalogId) ?? '—'}
                    {v.sessionIndex && v.packageTotal && (
                      <span className="ml-1 text-[var(--muted)]">
                        {v.sessionIndex}/{v.packageTotal}
                      </span>
                    )}
                  </td>
                  <td className="font-num py-1 text-right">{formatINR(v.actualBillPaise)}</td>
                </tr>
              );
            })}
            {sortedVisits.length === 0 && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-[var(--muted)]">
                  No visits in this month.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Per-therapist summary */}
        <h2 className="mt-8 text-sm font-bold text-[var(--ink)]">Monthly Summary</h2>
        <div className="mt-2 overflow-x-auto">
          <MonthlyReportTable report={report} hospitalSplit={hospitalSplit} own={labels.own} partner={labels.partner} />
        </div>

        <footer className="mt-8 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
          Generated {formatDateDMY(new Date().toISOString())} · {clinic.name}
          {clinic.partnerHospitalName ? ` — ${clinic.partnerHospitalName}` : ''}
        </footer>
      </div>
    </div>
  );
}
