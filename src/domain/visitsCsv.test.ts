import { describe, expect, it } from 'vitest';
import { visitsToCsv, type VisitsCsvRow } from './visitsCsv';
import { rupeesToPaise as rs } from './money';

function row(overrides: Partial<VisitsCsvRow> = {}): VisitsCsvRow {
  return {
    visitId: 'v1',
    visitDate: '2026-05-04',
    patientName: 'Anita Rao',
    mrno: 'H-100',
    therapistName: 'Prem',
    serviceName: 'Physiotherapy',
    condition: 'Back pain',
    billPaise: rs(2200),
    bmSharePaise: rs(1650),
    postTaxPaise: rs(1485),
    invoiced: true,
    ...overrides,
  };
}

describe('visitsToCsv', () => {
  it('leads with a quoted filter-description line before the header row', () => {
    const csv = visitsToCsv([row()], {
      filterDescription: 'This week (04/05/26–10/05/26), Therapist: All',
      hospitalSplit: true,
      ownShareLabel: 'BM',
    });
    const lines = csv.split('\n');
    expect(lines[0]).toBe('"This week (04/05/26–10/05/26), Therapist: All"');
    expect(lines[1]).toBe('"Date","Patient","Patient ID","Therapist","Service","Condition","Bill","BM Share","Post Tax","Invoiced"');
  });

  it('formats a data row with rupee amounts and DD/MM/YY dates', () => {
    const csv = visitsToCsv([row()], { filterDescription: 'All time', hospitalSplit: true, ownShareLabel: 'BM' });
    const lines = csv.split('\n');
    expect(lines[2]).toBe('"04/05/26","Anita Rao","H-100","Prem","Physiotherapy","Back pain","2200","1650","1485","Yes"');
  });

  it('omits the share/post-tax columns entirely when hospitalSplit is off', () => {
    const csv = visitsToCsv([row()], { filterDescription: 'All time', hospitalSplit: false, ownShareLabel: 'BM' });
    const lines = csv.split('\n');
    expect(lines[1]).toBe('"Date","Patient","Patient ID","Therapist","Service","Condition","Bill","Invoiced"');
    expect(lines[2]).toBe('"04/05/26","Anita Rao","H-100","Prem","Physiotherapy","Back pain","2200","Yes"');
  });

  it('ends with a totals line summing bill, share, and post-tax across all rows', () => {
    const csv = visitsToCsv(
      [row({ billPaise: rs(2200), bmSharePaise: rs(1650), postTaxPaise: rs(1485) }), row({ billPaise: rs(800), bmSharePaise: rs(600), postTaxPaise: rs(540) })],
      { filterDescription: 'All time', hospitalSplit: true, ownShareLabel: 'BM' }
    );
    const lines = csv.split('\n');
    expect(lines[lines.length - 1]).toBe('"","","","","","Total (2 visits)","3000","2250","2025",""');
  });

  it('escapes embedded quotes and commas in free-text fields', () => {
    const csv = visitsToCsv([row({ patientName: 'Rao, "Ani"', condition: null })], {
      filterDescription: 'All time',
      hospitalSplit: false,
      ownShareLabel: 'BM',
    });
    expect(csv.split('\n')[2]).toContain('"Rao, ""Ani"""');
  });

  it('produces just the description, header, and a zero totals line for an empty result', () => {
    const csv = visitsToCsv([], { filterDescription: 'No visits match', hospitalSplit: false, ownShareLabel: 'BM' });
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe('"","","","","","Total (0 visits)","0",""');
  });
});
