// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { groupRowsByDate } from './VisitCard';
import type { VisitCardData } from './visit/types';

// IST is where the bug showed: UTC-based date strings put local midnight on
// the 1st into the previous day.
process.env.TZ = 'Asia/Kolkata';

const row = (visitDate: string) => ({ visitDate, billPaise: 100 }) as unknown as VisitCardData;

describe('groupRowsByDate', () => {
  const today = new Date(2026, 9, 8, 11, 13); // Thu 8 Oct 2026, local

  it("files the last day of the previous month under 'Last month', not 'This month'", () => {
    const groups = groupRowsByDate([row('2026-09-30'), row('2026-09-15')], today);
    expect(groups.map((g) => g.label)).toEqual(['Last month']);
    expect(groups[0].rows).toHaveLength(2);
  });

  it("files the 1st of this month under 'This month'", () => {
    const groups = groupRowsByDate([row('2026-10-01'), row('2026-10-08'), row('2026-10-05')], today);
    expect(groups.map((g) => g.label)).toEqual(['Today', 'This week', 'This month']);
  });
});
