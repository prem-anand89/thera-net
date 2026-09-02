import type { UUID } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';

/** One of `message_log.kind`'s six existing values — kept here (not
 *  domain/types.ts) since it's only meaningful to the Business API send
 *  path; `send-whatsapp-template`'s own copy of this list is the real
 *  validation, this one just keeps the client call sites honest. */
export type WhatsAppMessageKind =
  | 'feedback_request'
  | 'booking_confirmation'
  | 'therapist_notify'
  | 'google_review'
  | 'reminder_stale_package'
  | 'reminder_single_visit';

/**
 * Patient Communications, Phase 9: thin wrappers around
 * `set_whatsapp_config`/`get_whatsapp_config_status`, used only by
 * Settings' "WhatsApp Business API" sub-block. The access token itself
 * never round-trips back to the client — `getConfigStatus` returns
 * `hasToken: boolean`, never the value; see the migration's own comment
 * on why `clinic_whatsapp_config` carries no SELECT policy for any
 * client role at all.
 *
 * `sendViaBusinessApi` is the one place any client code calls the
 * `send-whatsapp-template` Edge Function — see `src/lib/whatsappSend.ts`
 * for the shared "try Business API, fall back to the share sheet" wrapper
 * every send action actually calls; nothing calls this directly.
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

  /**
   * Calls `send-whatsapp-template` and reports simply whether it actually
   * sent — never throws, so callers (always `whatsappSend.ts`) can fall
   * back to the manual share sheet uniformly on any failure: not
   * configured, offline, an unapproved/mismatched template name Meta
   * rejects, or an unexpected error. `configured: true, success: true` is
   * the one case that counts as sent.
   */
  async sendViaBusinessApi(params: {
    clinicId: UUID;
    kind: WhatsAppMessageKind;
    toPhone: string;
    templateName: string;
    languageCode: string;
    bodyParams: string[];
  }): Promise<{ sent: boolean }> {
    const supabase = getSupabase();
    if (!supabase || !navigator.onLine) return { sent: false };
    try {
      const { data, error } = await supabase.functions.invoke('send-whatsapp-template', {
        body: params,
      });
      if (error) return { sent: false };
      const result = data as { configured?: boolean; success?: boolean } | null;
      return { sent: !!result?.configured && !!result?.success };
    } catch {
      return { sent: false };
    }
  },
};
