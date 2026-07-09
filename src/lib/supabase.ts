import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY, hasSupabaseConfig } from './env';

let client: SupabaseClient | null = null;

/** Null when the app has no Supabase config (e.g. fresh checkout without .env). */
export function getSupabase(): SupabaseClient | null {
  if (!hasSupabaseConfig) return null;
  if (!client) {
    client = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
      auth: {
        // Session persists in localStorage so the app reopens offline
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }
  return client;
}

/** Public URL for a file in the clinic-assets bucket, or null if unset/unconfigured. */
export function publicLogoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  return supabase.storage.from('clinic-assets').getPublicUrl(path).data.publicUrl;
}
