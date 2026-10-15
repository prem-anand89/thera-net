import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import type { Clinic } from '@/domain/types';

export type ActiveClinicStatus = 'loading' | 'ready' | 'none';

/**
 * Which clinic the app is showing. The stored pointer (`meta.activeClinicId`)
 * is the user's choice and is only ever written by an explicit switch/create
 * (`setActiveClinic`) or to seed it once when it has never been set. A
 * pointer that matches no local clinic (removed membership, mid-resync) is
 * left alone and the first clinic is shown instead, so the choice returns
 * once the clinic is known again.
 *
 * `undefined` inputs mean "Dexie query still loading" — distinct from `null`
 * (pointer never set) — and must never be treated as a missing pointer.
 */
export function resolveActiveClinic(
  clinics: Clinic[] | undefined,
  pointer: string | null | undefined
): { clinic: Clinic | null; status: ActiveClinicStatus } {
  if (clinics === undefined) return { clinic: null, status: 'loading' };
  if (clinics.length === 0) {
    return pointer === undefined
      ? { clinic: null, status: 'loading' }
      : { clinic: null, status: 'none' };
  }
  // One clinic is unambiguous, so don't wait on the pointer read.
  if (pointer === undefined) {
    return clinics.length === 1
      ? { clinic: clinics[0], status: 'ready' }
      : { clinic: null, status: 'loading' };
  }
  const known = pointer == null ? undefined : clinics.find((c) => c.id === pointer);
  return { clinic: known ?? clinics[0], status: 'ready' };
}

/** Persist the user's explicit clinic choice. Await it before navigating. */
export async function setActiveClinic(id: string): Promise<void> {
  await db.meta.put({ key: 'activeClinicId', value: id });
}

export function useActiveClinic(): {
  clinics: Clinic[] | undefined;
  clinic: Clinic | null;
  status: ActiveClinicStatus;
} {
  const clinics = useLiveQuery(() => db.clinics.toArray(), []);
  const pointer = useLiveQuery(
    async () => (await db.meta.get('activeClinicId'))?.value ?? null,
    []
  );

  // Seed the pointer once, only when it has never been set (null), never
  // while it is still loading (undefined) and never to "repair" a stale one.
  const firstId = clinics?.[0]?.id;
  useEffect(() => {
    if (pointer === null && firstId) void setActiveClinic(firstId);
  }, [pointer, firstId]);

  return { clinics, ...resolveActiveClinic(clinics, pointer) };
}
