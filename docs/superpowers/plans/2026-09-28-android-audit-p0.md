# Android Audit P0 & App Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all P0 security and sync race findings from the pre-Android audit, and lay the foundations for making the web app feel like a "proper app" (PWA manifest, accessibility).

**Architecture:** We will introduce a synchronous `stop()` method to the local-first sync engine to guarantee cache isolation between sessions. We will create a new Supabase migration to enforce strict same-clinic validation across all appointment RPCs. Finally, we will write RLS boundary integration tests using `@supabase/supabase-js`.

**Tech Stack:** React, Dexie, Supabase RPCs, Playwright (for API tests).

**Spec:** `docs/HANDOFF-patient-comms.md` and the provided Android Audit Handoff.

## Global Constraints

- No changes to existing RLS policies; only RPCs are modified.
- Sync cache clearing must be awaited before sign-out completes.
- All RPC checks must fail with standard exception messages (e.g. 'Not authorized.', 'Patient not found in this clinic.').

## Review Focus

- Sync writes executing after sign-out due to un-awaited promises.
- Cross-clinic access where an appointment is linked to a visit in Clinic A but a patient in Clinic B.
- Therapist selection allowing staff to assign a Clinic B therapist to a Clinic A appointment.

---

### Task 1: Sync Engine Sign-Out Race Fix

**Files:**
- Modify: `src/sync/engine.ts`
- Modify: `src/app/Shell.tsx`
- Modify: `src/app/signOut.ts`

**Interfaces:**
- Produces: `syncEngine.stop(): Promise<void>`

- [ ] **Step 1: Write `stop` method in SyncEngine**
  Add a `stop()` method to `src/sync/engine.ts` that clears the debounce timer, unsubscribes from the realtime channel, waits for `this.running` to be false, and sets `this.started = false`. Inside `push()` and `pull()`, add checks for `this.started` to abort early if stopped.

```typescript
// Add to SyncEngine class:
private channel: any = null;

async stop(): Promise<void> {
  this.started = false;
  if (this.debounceTimer) clearTimeout(this.debounceTimer);
  if (this.channel) {
    await this.supabase?.removeChannel(this.channel);
    this.channel = null;
  }
  while (this.running) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
```
*Note: Also update `start()` to store the channel in `this.channel` instead of a local variable.*

- [ ] **Step 2: Coordinate cleanup in `Shell.tsx`**
  Modify the cleanup effect in `src/app/Shell.tsx` to launch an awaited cleanup sequence instead of un-awaited promises.

```typescript
if (!session || isSwappingUsers) {
  void (async () => {
    await syncEngine.stop();
    for (const table of ALL_SYNCED_TABLES) await db.table(table).clear();
    await db.outbox.clear();
    await db.meta.clear();
    syncStatus.reset();
  })();
}
```

- [ ] **Step 3: Update `signOutSafely`**
  Modify `src/app/signOut.ts` to stop the sync engine before signing out.

```typescript
// Replace await syncEngine.sync().catch(() => {});
await syncEngine.stop();
// wait for cleanup...
```
*(Wait, `sync()` does the push. If we stop it, we can't push. The outbox push is desired before sign out. So `syncEngine.sync()` is fine, but we should call `stop()` after `sync()` and before `auth.signOut()`.)*

- [ ] **Step 4: Commit**
```bash
git add src/sync/engine.ts src/app/Shell.tsx src/app/signOut.ts
git commit -m "fix: resolve sign-out and sync race condition"
```

---

### Task 2: Cross-Clinic Validation in RPCs

**Files:**
- Create: `supabase/migrations/20260928000000_audit_p0_fixes.sql`

**Interfaces:**
- Modifies: `link_appointment_visit`, `create_appointment_staff`, `confirm_appointment_request`, `submit_appointment_request`

- [ ] **Step 1: Write migration for RPCs**

```sql
-- supabase/migrations/20260928000000_audit_p0_fixes.sql
-- Fix P0 findings: cross-clinic appointment linking and therapist validation

-- 1. link_appointment_visit
create or replace function public.link_appointment_visit(
  p_appointment_id uuid,
  p_visit_id uuid,
  p_patient_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_clinic_id uuid;
begin
  select clinic_id into v_clinic_id from appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'Appointment not found.';
  end if;
  if not is_clinic_member(v_clinic_id) then
    raise exception 'Not authorized.';
  end if;

  if not exists (select 1 from patients where id = p_patient_id and clinic_id = v_clinic_id) then
    raise exception 'Patient not found in this clinic.';
  end if;

  if not exists (select 1 from visits where id = p_visit_id and patient_id = p_patient_id and clinic_id = v_clinic_id) then
    raise exception 'Visit does not belong to this patient or clinic.';
  end if;

  update appointments
    set patient_id = p_patient_id, visit_id = p_visit_id, status = 'arrived'
    where id = p_appointment_id;
end $$;

-- (Do the same for create_appointment_staff, confirm_appointment_request, submit_appointment_request to validate therapist_id against clinic_id)
-- Note: Provide full definitions in actual execution.
```

- [ ] **Step 2: Apply migration and verify**
```bash
npx supabase db reset
```

- [ ] **Step 3: Commit**
```bash
git add supabase/migrations/
git commit -m "fix: enforce same-clinic validation on appointment RPCs"
```

---

### Task 3: RLS Boundary Tests

**Files:**
- Create: `e2e/rls-boundaries.spec.ts`

- [ ] **Step 1: Write API tests in Playwright**
Create `e2e/rls-boundaries.spec.ts` to test that a user from Clinic A cannot read/update/delete/insert records for Clinic B.

```typescript
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

test.describe('RLS Boundaries', () => {
  test('User in Clinic A cannot read Clinic B patients', async () => {
    // Setup supabase client with User A's token
    // Attempt to select from patients where clinic_id = Clinic B
    // Assert length === 0
  });

  test('Cross-clinic appointment linking fails', async () => {
    // Try to call link_appointment_visit with mismatched clinic IDs
    // Assert it throws expected error
  });
});
```

- [ ] **Step 2: Run tests**
```bash
npx playwright test e2e/rls-boundaries.spec.ts
```

- [ ] **Step 3: Commit**
```bash
git add e2e/rls-boundaries.spec.ts
git commit -m "test: add direct API tests for RLS cross-clinic boundaries"
```

---

### Task 4: App Foundations (PWA & Accessibility)

**Files:**
- Modify: `vite.config.ts`
- Modify: `index.html`

- [ ] **Step 1: Install vite-plugin-pwa**
```bash
npm install -D vite-plugin-pwa
```

- [ ] **Step 2: Configure PWA in vite.config.ts**
Add `VitePWA` plugin with basic manifest for standalone mode (makes it installable on Android).

- [ ] **Step 3: Update index.html meta tags**
Add `theme-color`, `apple-touch-icon`, and `description` meta tags to `index.html` to improve mobile presentation.

- [ ] **Step 4: Commit**
```bash
git add package.json package-lock.json vite.config.ts index.html
git commit -m "feat: add PWA manifest and mobile app meta tags"
```
