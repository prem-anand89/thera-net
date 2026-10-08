import { getSupabase } from '@/lib/supabase';

export type PushState = 'unsupported' | 'needs-install' | 'default' | 'denied' | 'on';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string;

function isStandalone(): boolean {
  return (
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/** A local subscription can exist on this device while the server-side row
 *  has been reassigned to a different user — see `register_push_subscription`'s
 *  intentional "last registration wins" (a single browser subscription
 *  object can only ever belong to one user, so re-registering on a shared
 *  kiosk correctly hands it to whoever's signed in now). Without this
 *  check, `pushState()` would keep reporting "on" for whoever enabled it
 *  first, even after a different user on the same device took over the
 *  endpoint — a stale, incorrect status. RLS already scopes `select` to
 *  the caller's own rows, so this simply returns no row once ownership has
 *  moved elsewhere. */
async function subscriptionOwnedByCurrentUser(endpoint: string): Promise<boolean> {
  const supabase = getSupabase();
  if (!supabase) return false;
  const { data } = await supabase.from('push_subscriptions').select('endpoint').eq('endpoint', endpoint).maybeSingle();
  return data != null;
}

export async function pushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (Notification.permission === 'denied') return 'denied';

  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg && !isStandalone()) return 'needs-install';

  if (Notification.permission !== 'granted') return 'default';
  if (!reg) return 'default';
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return 'default';
  return (await subscriptionOwnedByCurrentUser(sub.endpoint)) ? 'on' : 'default';
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Must be called directly from a click handler (iOS rejects prompts otherwise). The RPC takes the owner from the session, so a browser that changed accounts re-claims its endpoint. */
export async function enablePushForThisDevice(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Not connected.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications are not allowed.');
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('Notifications work in the installed or production build only.');
  if (!VAPID_PUBLIC_KEY) throw new Error('Push notifications are not configured on this server.');
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
  });
  const json = sub.toJSON();
  const { error } = await supabase.rpc('register_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

export async function disablePushForThisDevice(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const supabase = getSupabase();
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  if (supabase) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
