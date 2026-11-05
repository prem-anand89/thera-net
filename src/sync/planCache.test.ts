import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { applyPlanChange, planCacheKey } from './planCache';

describe('planCache', () => {
  beforeEach(async () => {
    await db.meta.clear();
  });

  describe('planCacheKey', () => {
    it('returns plan:<clinicId>', () => {
      expect(planCacheKey('c123')).toBe('plan:c123');
    });
  });

  describe('applyPlanChange', () => {
    it('writes key plan:<clinic_id> whose parsed value has planTier', async () => {
      await applyPlanChange({
        clinic_id: 'c1',
        plan_tier: 'solo',
        status: 'active',
        max_members: 1,
      });

      const entry = await db.meta.get(planCacheKey('c1'));
      expect(entry).toBeDefined();
      const parsed = JSON.parse(entry!.value);
      expect(parsed.planTier).toBe('solo');
      expect(parsed.status).toBe('active');
      expect(parsed.maxMembers).toBe(1);
    });

    it('writes nothing for empty object, null, or undefined', async () => {
      await applyPlanChange({});
      await applyPlanChange(null);
      await applyPlanChange(undefined);
      await applyPlanChange({ other_field: 'value' });

      const all = await db.meta.toArray();
      expect(all).toEqual([]);
    });
  });
});

