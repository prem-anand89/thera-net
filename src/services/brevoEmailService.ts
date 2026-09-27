import type { UUID } from '@/domain/types';
import { getSupabase } from '@/lib/supabase';

export interface BrevoConfigStatus {
  enabled: boolean;
  senderEmail: string | null;
  hasApiKey: boolean;
}

export const brevoEmailService = {
  async getConfigStatus(clinicId: UUID): Promise<BrevoConfigStatus | null> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('No Supabase connection');

    const { data, error } = await supabase.rpc('get_brevo_config_status', {
      p_clinic_id: clinicId,
    });

    if (error) throw error;
    if (!data || data.length === 0) return null;

    return {
      enabled: data[0].enabled,
      senderEmail: data[0].sender_email,
      hasApiKey: data[0].has_api_key,
    };
  },

  async setConfig(
    clinicId: UUID,
    senderEmail: string | null,
    apiKey: string | null,
    enabled: boolean
  ): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('No Supabase connection');

    const { error } = await supabase.rpc('set_brevo_config', {
      p_clinic_id: clinicId,
      p_api_key: apiKey,
      p_sender_email: senderEmail,
      p_enabled: enabled,
    });

    if (error) throw error;
  },
};
