import readXlsxFile, { type SheetData } from 'read-excel-file/browser';

/**
 * Sheet tabs in the historical Beyond Mechanics workbook that actually
 * contain visit rows (other tabs are empty templates, pivot summaries, or
 * a "Shared Sessions" layout the app's data model doesn't represent).
 */
const MONTH_SHEETS = ['April', 'May', 'June'];

const REQUIRED_HEADERS = ['Date', 'Patients', 'MRNO', 'Therapist', 'Service Name', 'Bill Amount'];

export interface RawImportRow {
  sheet: string;
  /** Position among this sheet's data rows (0-based) — used to break ties when sorting same-day rows */
  sheetRowIndex: number;
  dateRaw: unknown;
  patientName: string;
  mrno: string;
  ageSex: string | null;
  condition: string | null;
  therapistName: string;
  treatmentNotes: string | null;
  serviceNameRaw: string;
  billAmountRupees: number;
}

function cellToString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * Locates the header row by content rather than a fixed row index, since
 * month sheets have a title row above the header ("Apr 1 - Apr 30 Own
 * Clients") that other tabs in the same workbook don't.
 */
function findHeaderRow(
  rows: SheetData
): { rowIndex: number; colOf: Map<string, number> } | null {
  for (let i = 0; i < rows.length; i++) {
    const colOf = new Map<string, number>();
    rows[i].forEach((cell, idx) => {
      if (typeof cell === 'string') colOf.set(cell.trim(), idx);
    });
    if (REQUIRED_HEADERS.every((h) => colOf.has(h))) return { rowIndex: i, colOf };
  }
  return null;
}

export async function extractHistoricalRows(file: File): Promise<RawImportRow[]> {
  const sheets = await readXlsxFile(file);
  const rows: RawImportRow[] = [];

  for (const { sheet: sheetName, data } of sheets) {
    if (!MONTH_SHEETS.includes(sheetName)) continue;
    const header = findHeaderRow(data);
    if (!header) continue; // defensive: an empty/reshaped month tab has nothing to import

    const col = (name: string) => header.colOf.get(name)!;
    let sheetRowIndex = 0;
    for (let i = header.rowIndex + 1; i < data.length; i++) {
      const row = data[i];
      const patientName = cellToString(row[col('Patients')]);
      if (!patientName) continue; // blank template rows past the real entries

      const mrno = cellToString(row[col('MRNO')]);
      if (!mrno) continue; // can't import a patient with no MRNO to key on

      rows.push({
        sheet: sheetName,
        sheetRowIndex: sheetRowIndex++,
        dateRaw: row[col('Date')],
        patientName,
        mrno,
        ageSex: cellToString(row[col('A/S')]),
        condition: cellToString(row[col('Condition')]),
        therapistName: cellToString(row[col('Therapist')]) ?? '',
        treatmentNotes: cellToString(row[col('Treatment')]),
        serviceNameRaw: cellToString(row[col('Service Name')]) ?? '',
        billAmountRupees: Number(row[col('Bill Amount')]) || 0,
      });
    }
  }
  return rows;
}
