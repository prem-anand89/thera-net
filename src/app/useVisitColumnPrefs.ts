import { useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import { DEFAULT_VISIT_COLUMN_PREFS, type VisitColumnKey } from '@/domain/types';

const META_KEY = 'visitColumnPrefs';

/**
 * Which optional Visits-table columns show, per user rather than per
 * clinic — this device's own choice, in Dexie's local `meta` table, not
 * synced to the server. Superseded `Clinic.visitColumnPrefs`, which was
 * clinic-wide and never actually read by any table.
 */
export function useVisitColumnPrefs(): {
  prefs: Record<VisitColumnKey, boolean>;
  setPref: (key: VisitColumnKey, visible: boolean) => void;
} {
  const stored = useLiveQuery(() => db.meta.get(META_KEY), []);
  const parsed: Partial<Record<VisitColumnKey, boolean>> = stored ? safeParse(stored.value) : {};
  const prefs = { ...DEFAULT_VISIT_COLUMN_PREFS, ...parsed };

  const setPref = useCallback((key: VisitColumnKey, visible: boolean) => {
    void (async () => {
      const current = await db.meta.get(META_KEY);
      const currentPrefs = current ? safeParse(current.value) : {};
      const next = { ...currentPrefs, [key]: visible };
      await db.meta.put({ key: META_KEY, value: JSON.stringify(next) });
    })();
  }, []);

  return { prefs, setPref };
}

function safeParse(value: string): Partial<Record<VisitColumnKey, boolean>> {
  try {
    const parsed = JSON.parse(value) as Partial<Record<VisitColumnKey, boolean>>;
    // Validate that the parsed object contains only valid keys
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Parsed value is not an object');
    }
    return parsed;
  } catch (error) {
    // Log the failure for debugging, but fail gracefully by returning empty prefs
    console.warn(
      '[useVisitColumnPrefs] Failed to parse stored preferences:',
      error instanceof Error ? error.message : String(error)
    );
    // Return empty object so defaults are used; user's choice will be saved on next update
    return {};
  }
}
