// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import { repos } from '@/repositories/local';
import type { PushKind } from '../../supabase/functions/send-push/templates';
import {
  PUSH_CATEGORIES,
  PUSH_CATEGORY_BY_KIND,
  PUSH_CATEGORY_COPY,
  pushCategoriesFor,
  pushPreferenceId,
  withoutOptedOut,
  type PushCategory,
} from './pushPreferences';

// Compile-time guard: every kind send-push can send must have a switch. Adding a PushKind
// without mapping it here fails typecheck.
const _everyKindHasASwitch: Record<PushKind, PushCategory> = PUSH_CATEGORY_BY_KIND;
void _everyKindHasASwitch;

describe('push alert switches', () => {
  it('maps every push kind to a known switch with its own copy', () => {
    for (const category of Object.values(PUSH_CATEGORY_BY_KIND)) {
      expect(PUSH_CATEGORIES).toContain(category);
    }
    for (const category of PUSH_CATEGORIES) {
      expect(PUSH_CATEGORY_COPY[category].label.length).toBeGreaterThan(0);
      expect(PUSH_CATEGORY_COPY[category].description.length).toBeGreaterThan(0);
    }
  });

  it('offers each role only the alerts it can receive', () => {
    expect(pushCategoriesFor('front_desk', false)).toEqual(['booking_request']);
    expect(pushCategoriesFor('admin', false)).toEqual(['booking_request', 'low_rating_feedback']);
    expect(pushCategoriesFor('therapist', true)).toEqual(['appointment_changes']);
    expect(pushCategoriesFor('therapist', false)).toEqual([]);
    // Anyone linked to a therapist profile also gets appointment alerts.
    expect(pushCategoriesFor('admin', true)).toEqual(['booking_request', 'appointment_changes', 'low_rating_feedback']);
  });

  it('removes only the people who switched the alert off', () => {
    expect(withoutOptedOut(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    expect(withoutOptedOut(['a', 'b'], [])).toEqual(['a', 'b']);
    expect(withoutOptedOut(['a'], ['a'])).toEqual([]);
    expect(withoutOptedOut(['a'], ['zzz'])).toEqual(['a']);
  });

  it('uses the same deterministic id on every device', () => {
    expect(pushPreferenceId('u1', 'c1', 'booking_request')).toBe('u1:c1:booking_request');
    expect(pushPreferenceId('u1', 'c1', 'booking_request')).not.toBe(pushPreferenceId('u1', 'c2', 'booking_request'));
  });
});

describe('repos.userPushPreferences', () => {
  beforeEach(async () => {
    await db.user_push_preferences.clear();
    await db.outbox.clear();
  });

  it('stores one row per alert, queues it for sync, and flips it back by writing enabled again', async () => {
    await repos.userPushPreferences.setEnabled('u1', 'c1', 'booking_request', false);
    expect((await repos.userPushPreferences.listForUser('u1', 'c1')).map((p) => [p.category, p.enabled])).toEqual([['booking_request', false]]);
    expect(await db.outbox.count()).toBe(1);

    await repos.userPushPreferences.setEnabled('u1', 'c1', 'booking_request', false); // unchanged: no extra write
    expect(await db.outbox.count()).toBe(1);

    await repos.userPushPreferences.setEnabled('u1', 'c1', 'booking_request', true);
    const rows = await repos.userPushPreferences.listForUser('u1', 'c1');
    expect(rows).toHaveLength(1);
    expect(rows[0].enabled).toBe(true);
  });

  it('keeps users and clinics separate', async () => {
    await repos.userPushPreferences.setEnabled('u1', 'c1', 'booking_request', false);
    await repos.userPushPreferences.setEnabled('u2', 'c1', 'booking_request', false);
    await repos.userPushPreferences.setEnabled('u1', 'c2', 'booking_request', false);
    expect(await repos.userPushPreferences.listForUser('u1', 'c1')).toHaveLength(1);
    expect(await db.user_push_preferences.count()).toBe(3);
  });
});
