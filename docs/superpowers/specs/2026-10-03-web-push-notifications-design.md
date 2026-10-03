# Web Push Notifications — Design

Date: 2026-10-03
Status: Draft for review

## Goal

Alert staff and therapists when something needs their attention, even when Thera.Net is not open. Today only in-app bells and an email to therapists exist, so nothing reaches a therapist who is busy or doesn't open email.

## Understanding (agreed scope)

- **Therapist:** push on new confirmation, reschedule, or cancellation of their own appointment.
- **Admin and front desk:** push on every new public booking request (`appointment_requests` insert) for their clinic.
- **Admin only:** push on every 1–2 star feedback response.
- **Content:** therapist and feedback payloads carry no patient data. Booking-request payloads show the patient's name, preferred date, and the chosen slot time, which the partner chose explicitly. Notifications show on lock screens.
- **Devices:** one user may subscribe on several devices; every subscribed device receives the push.
- **Out of scope:** changes to the existing email (`notify-therapist`), the in-app bells, and the manual WhatsApp button.

## Approach

Native Web Push (VAPID + RFC 8291 encryption), no third-party push vendor. Patient data never leaves our infrastructure except as opaque encrypted payloads to the browser vendor's push service, and our payloads contain no patient data.

## Data model

```sql
create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
```

- Keyed to the user and device (`endpoint`), not to a clinic. Recipients are resolved at send time from clinic membership, so a user in several clinics needs one subscription.
- RLS: a user may insert, update, and delete only their own rows. Reads for sending use the service role only.
- Re-subscribing the same endpoint upserts on `endpoint`.

## Sending

**Edge function `send-push`** (Deno, `verify_jwt: false`, authenticated by a shared secret header, same convention as the existing `notify-therapist` function):

- Input: `{ clinic_id, recipient_user_ids | recipient_role, kind, when }`. The payload is built server-side from a fixed template per `kind`, so no caller can inject patient data.
- Loads all `push_subscriptions` for the resolved recipients, encrypts the payload per subscription (RFC 8291, aes128gcm), signs a VAPID JWT, and posts to each endpoint in parallel with `Promise.allSettled`.
- Responses:
  - `201` success.
  - `404` or `410`: delete that subscription row.
  - `429` or `5xx`: log and skip. No retry queue in v1.
  - `413`: a bug in payload size; log.
- Implementation: no `web-push` npm package (Node-only). Use Web Crypto (ECDH, HKDF, AES-GCM, ECDSA P-256) directly, or a Deno-compatible library if one is verified during implementation.

**Triggers** (Postgres, calling `send-push` via `pg_net`, asynchronous so writes never block on push):

| Source | Condition | Recipients | Template |
|---|---|---|---|
| `appointments` | insert or update of `status`/`scheduled_at` to confirmed (new or rescheduled), or to cancelled | the therapist (`therapists.user_id`) | "Appointment {confirmed\|rescheduled\|cancelled} at {time}" |
| `appointment_requests` | insert | clinic admins and front desk | "New booking request" · {patient name} · {date} · {slot time} |
| `feedback_responses` | insert with `rating <= 2` | clinic admins | "New low-rated feedback" |

Times are shown in clinic-local time. Repeated alerts are collapsed on the device by a per-kind `tag` (see service worker), so no count is included in the payload.

## Client

**Service worker.** The current build uses `vite-plugin-pwa` in `generateSW` mode, which cannot host custom handlers. Switch to `injectManifest` with `src/sw.ts`:

- `precacheAndRoute(self.__WB_MANIFEST)` retains current precache behavior.
- `push` event: show notification with a fixed `tag` per kind, so repeated alerts replace each other.
- `notificationclick`: `clients.matchAll({ type: 'window' })`, focus and navigate the first client to the target route (`/schedule` with the relevant tab), else `openWindow`.

**Subscription.** After permission is granted, call `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })` and upsert the result. The VAPID key pair is generated once, stored in Supabase secrets (private) and the build env (public), and never rotated, since rotation silently invalidates every subscription.

**Sign-out.** Unsubscribe the browser and delete its `push_subscriptions` row before clearing the session. A shared front-desk computer must not deliver the previous staff member's alerts to the next login.

## Permission and install UX

**Enabling notifications**
- Never prompt on first load.
- Settings → Notifications card for every role that receives pushes, plus a dismissible nudge on Workspace after the user's second visit.
- The Enable button calls `Notification.requestPermission()` directly in its click handler (required by iOS).
- Copy: "Get an alert when a new booking request or a schedule change comes in. We never include patient names."
- States:
  - Default: Enable button.
  - Granted and subscribed: "On" with Turn off.
  - Denied: instructions to re-enable in browser or phone settings. The app cannot re-prompt.
  - Unsupported (iOS Safari tab): "Install the app first."
- Dismissals stored in `db.meta`; re-ask at most every 30 days.

**Installing**
- Android Chrome, Edge, desktop Chrome: capture `beforeinstallprompt`, show our own "Install app" button, call `prompt()` on tap. Hidden when running standalone.
- iOS Safari (non-standalone): one-time sheet with steps — Share, then "Add to Home Screen" — dismissible.
- The Home Screen app has separate storage. Users sign in again there and data re-syncs. The install copy says so.

## Error handling

- Push send failures never block or roll back the originating write (async via `pg_net`).
- Subscription failures in the client show a toast and leave the toggle off; no retry loop.
- Missing VAPID secret: `send-push` returns 500 and logs; the write still succeeds.

## Testing

- Unit: payload templates per kind (asserts no patient name field is ever read); recipient resolution (multi-clinic user, therapist without `user_id`, front desk vs admin for feedback).
- Edge function: mock push endpoints returning 201, 404, 410, 429; assert deletion only on 404/410.
- Client: permission state rendering for each state; sign-out removes the subscription.
- Manual on real devices: Android Chrome, desktop Chrome, iOS Home Screen app. Verify a push arrives with the app closed, and that tapping routes to the right tab.

## Migration and docs

- Two migrations: `push_subscriptions` with RLS, and the triggers. Apply live via Supabase MCP and commit matching files. If the apply tool declines a statement containing `DROP`, apply it manually and record the version.
- Update FEATURES_AND_SCHEMA.md (new table, triggers, notification rules) and README in the same PR.

## Open items for implementation planning

- Confirm `pg_net` is enabled on the project (the existing `notify-therapist` trigger may already depend on it).
- Confirm the VAPID key storage and build-env wiring.
- Verify a Deno-compatible RFC 8291 implementation during planning, or implement the small Web Crypto version.
