// The categories, kind mapping and copy live in ONE file shared with the send-push edge
// function (it must be dependency-free so both sides can import it), so the settings
// screen and the server can never disagree about which alert belongs to which switch.
export {
  PUSH_CATEGORIES,
  PUSH_CATEGORY_BY_KIND,
  PUSH_CATEGORY_COPY,
  PUSH_CATEGORY_DEFAULT,
  pushCategoriesFor,
  withoutOptedOut,
  type PushCategory,
} from '../../supabase/functions/send-push/preferences';
import type { PushCategory } from '../../supabase/functions/send-push/preferences';

/** Deterministic row id: one row per (user, clinic, alert), the same on every device; the server enforces it. */
export function pushPreferenceId(userId: string, clinicId: string, category: PushCategory): string {
  return `${userId}:${clinicId}:${category}`;
}
