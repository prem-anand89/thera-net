// HEP pictures, staff side. The hep-media edge function checks the caller's login and clinic before it signs anything;
// the browser then uploads straight to the private R2 bucket (the picture never passes through our servers).
import { getSupabase } from '@/lib/supabase';
import { HEP_NEEDS_CONNECTION } from '@/services/hepService';

export type UploadSlot = number | 'thumb';

export interface MintedUpload {
  slot: UploadSlot;
  key: string;
  url: string;
  /** Headers the signed URL requires on the PUT (for example Cache-Control). */
  headers: Record<string, string>;
}

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Supabase is not configured');
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error(HEP_NEEDS_CONNECTION);
  return supabase;
}

async function invoke(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await client().functions.invoke('hep-media', { body });
  if (error) {
    // A refusal still carries our { ok: false, reason } body.
    const ctx = (error as { context?: unknown }).context;
    if (ctx && typeof (ctx as Response).json === 'function') {
      try {
        const b = (await (ctx as Response).json()) as Record<string, unknown>;
        if (b.reason === 'unavailable') throw new Error('Pictures are not set up yet. Ask the owner to finish the picture storage setup.');
        if (b.reason === 'forbidden') throw new Error('You cannot change pictures for this clinic.');
      } catch (e) {
        if (e instanceof Error && e.message !== 'Unexpected end of JSON input' && !(e instanceof SyntaxError)) throw e;
      }
    }
    throw new Error('Could not reach the picture storage. Check your connection and try again.');
  }
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.ok !== true) throw new Error('Could not use the picture storage. Try again.');
  return d;
}

export const hepMediaService = {
  /** New keys for pictures of one exercise. The server chooses the keys (a fresh random suffix every time). */
  async mintUploadUrls(clinicId: string, exerciseId: string, slots: UploadSlot[]): Promise<MintedUpload[]> {
    const d = await invoke({ action: 'mint_upload_urls', clinicId, exerciseId, slots });
    return (d.uploads as MintedUpload[]) ?? [];
  },

  /** Short-lived viewing links for keys that sit inside this clinic's folder, as { key: url }. */
  async mintViewUrls(clinicId: string, keys: string[]): Promise<Record<string, string>> {
    if (keys.length === 0) return {};
    const out: Record<string, string> = {};
    for (let i = 0; i < keys.length; i += 60) {
      const d = await invoke({ action: 'mint_view_urls', clinicId, keys: keys.slice(i, i + 60) });
      Object.assign(out, (d.urls as Record<string, string>) ?? {});
    }
    return out;
  },

  /** Sends one picture to its signed URL. */
  async putBlob(upload: Pick<MintedUpload, 'url' | 'headers'>, blob: Blob): Promise<void> {
    const res = await fetch(upload.url, { method: 'PUT', headers: { ...upload.headers, 'Content-Type': blob.type || 'application/octet-stream' }, body: blob });
    if (!res.ok) throw new Error(`The picture could not be saved (${res.status}). Try again.`);
  },
};
