import type { UUID } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';

/**
 * Patient Communications, Phase 9 (scaffold): thin wrappers around
 * `set_whatsapp_config`/`get_whatsapp_config_status`, used only by
 * Settings' "WhatsApp Business API" sub-block. The access token itself
 * never round-trips back to the client — `getConfigStatus` returns
 * `hasToken: boolean`, never the value; see the migration's own comment
 * on why `clinic_whatsapp_config` carries no SELECT policy for any
 * client role at all.
 *
 * Deliberately does not include a `sendViaBusinessApi` — nothing in the
 * app calls the new `send-whatsapp-template` Edge Function yet. Wiring
 * the six existing share-sheet send sites to it is a later pass, once a
 * clinic actually has a real Meta phone number ID, access token, and at
 * least one approved template name to test against.
 */
export const whatsappBusinessService = {
  async getConfigStatus(
    clinicId: UUID
  ): Promise<{ enabled: boolean; phoneNumberId: string | null; hasToken: boolean } | null> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase is not configured');
    const { data, error } = await supabase.rpc('get_whatsapp_config_status', {
      p_clinic_id: clinicId,
    });
    if (error) throw new Error(error.message);
    const row = (
      data as { enabled: boolean; phone_number_id: string | null; has_token: boolean }[] | null
    )?.[0];
    if (!row) return null;
    return { enabled: row.enabled, phoneNumberId: row.phone_number_id, hasToken: row.has_token };
  },

  /** `accessToken: null` leaves the currently stored token untouched
   *  (see the RPC's own comment) — pass `''` to explicitly clear it. */
  async setConfig(
    clinicId: UUID,
    phoneNumberId: string | null,
    accessToken: string | null,
    enabled: boolean
  ): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('Supabase is not configured');
    const { error } = await supabase.rpc('set_whatsapp_config', {
      p_clinic_id: clinicId,
      p_phone_number_id: phoneNumberId,
      p_access_token: accessToken,
      p_enabled: enabled,
    });
    if (error) throw new Error(error.message);
  },
};
