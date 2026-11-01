import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TIER_LIMITS } from './plans';

/**
 * `plan_tier_defaults()` in the migration and `TIER_LIMITS` in plans.ts are two copies of the same numbers (SQL for the
 * server, TypeScript for the wording). If one is edited alone, the Settings page would promise something the server does
 * not enforce. This reads the migration's VALUES table and compares it with the app's.
 */
describe('plan_tier_defaults matches TIER_LIMITS', () => {
  const sql = readFileSync('supabase/migrations/20261101100000_plan_limits_roster_cap.sql', 'utf8');
  const rows = [...sql.matchAll(/\(\s*'(lite|solo|clinic|clinic_plus)'\s*,\s*(\d+)\s*,\s*(\d+|null(?:::int)?)\s*,\s*(\d+)\s*\)/g)];

  it('lists every tier once', () => {
    expect(rows.map((r) => r[1]).sort()).toEqual(['clinic', 'clinic_plus', 'lite', 'solo']);
  });

  for (const tier of ['lite', 'solo', 'clinic', 'clinic_plus'] as const) {
    it(`${tier}: seats, monthly visits and team without a login are the same`, () => {
      const row = rows.find((r) => r[1] === tier)!;
      expect({
        seats: Number(row[2]),
        visitsPerMonth: row[3].startsWith('null') ? null : Number(row[3]),
        rosterWithoutLogin: Number(row[4]),
      }).toEqual(TIER_LIMITS[tier]);
    });
  }
});
