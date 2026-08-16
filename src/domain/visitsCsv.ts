import type { Paise } from './money';
import { paiseToRupees } from './money';
import { formatDateDMY } from './fiscalYear';
import type { UUID } from './types';

export interface VisitsCsvRow {
  visitId: UUID;
  visitDate: string;
  patientName: string;
  mrno: string;
  therapistName: string;
  serviceName: string;
  condition: string | null;
  billPaise: Paise;
  bmSharePaise: Paise;
  postTaxPaise: Paise;
  invoiced: boolean;
}

function csvLine(cells: unknown[]): string {
  return cells.map((c) => `"${String(c ?? '').replaceAll('"', '""')}"`).join(',');
}

/**
 * Serializes a Ledger visit list to CSV. The first line is a single quoted
 * cell describing the active filter (date range, therapist, patient) —
 * spreadsheet tools show it as an ordinary first row, but it means a
 * downloaded file is never ambiguous about what it's a snapshot of. Ends
 * with a totals line, matching reportService.toCsv's convention.
 */
export function visitsToCsv(
  rows: VisitsCsvRow[],
  opts: { filterDescription: string; hospitalSplit: boolean; ownShareLabel: string }
): string {
  const header = [
    'Date',
    'Patient',
    'Patient ID',
    'Therapist',
    'Service',
    'Condition',
    'Bill',
    ...(opts.hospitalSplit ? [`${opts.ownShareLabel} Share`, 'Post Tax'] : []),
    'Invoiced',
  ];
  const line = (r: VisitsCsvRow) => [
    formatDateDMY(r.visitDate),
    r.patientName,
    r.mrno,
    r.therapistName,
    r.serviceName,
    r.condition ?? '',
    paiseToRupees(r.billPaise),
    ...(opts.hospitalSplit ? [paiseToRupees(r.bmSharePaise), paiseToRupees(r.postTaxPaise)] : []),
    r.invoiced ? 'Yes' : 'No',
  ];
  const totals = rows.reduce(
    (acc, r) => ({
      billPaise: acc.billPaise + r.billPaise,
      bmSharePaise: acc.bmSharePaise + r.bmSharePaise,
      postTaxPaise: acc.postTaxPaise + r.postTaxPaise,
    }),
    { billPaise: 0, bmSharePaise: 0, postTaxPaise: 0 }
  );
  const totalLine = [
    '',
    '',
    '',
    '',
    '',
    `Total (${rows.length} visit${rows.length === 1 ? '' : 's'})`,
    paiseToRupees(totals.billPaise),
    ...(opts.hospitalSplit ? [paiseToRupees(totals.bmSharePaise), paiseToRupees(totals.postTaxPaise)] : []),
    '',
  ];
  return [
    csvLine([opts.filterDescription]),
    csvLine(header),
    ...rows.map((r) => csvLine(line(r))),
    csvLine(totalLine),
  ].join('\n');
}
