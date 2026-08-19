# Settings — review and simplification

How the Settings tab is structured today, what works, where it is hard to use, and a recommended reorganisation. For product and engineering; not a build plan with shipped checkboxes.

Settings is **admin-only** (`canEditSettings`). Non-admins hitting `/settings` see a short “managed by your clinic admin” page. The real access boundary is RLS on `clinics` / `therapists` / `service_catalog`.

Primary code: `src/features/settings/SettingsPage.tsx`, `src/features/settings/FirstWeekChecklist.tsx`.

---

## What it does well

Keep these.

- **Three rail groups** (Clinic / People & services / System) match admin jobs better than a flat list of eight peers.
- **Independent Save per clinic-row slice** (`useClinicSectionForm`) so one tab cannot silently overwrite another.
- **Team** is the right density for the hard problem: logins vs names that appear on visits.
- **Unlinked-therapist banner** and auto-opening Team when someone is unlinked is the right interrupt.
- **Data & maintenance** correctly puts import, backup, cache reset, and wipe in one place (instead of two adjacent tabs).
- **Admin-only Settings** in nav (`Shell.tsx`) plus the empty state for a direct URL.

---

## How admins actually use it

Three cadences:

| When | Jobs | Current home |
|------|------|----------------|
| First week | Invite people, prices, UPI, invoice prefix | Team, Services, Billing, First-week card |
| Monthly | Price tweak, invite, GST | Services, Billing, Team |
| Rare | Partner %, FY start, wipe, feature flags | Partner, Features, Data |

The rail is ordered **profile → billing → partner → team → services → features → data**. First-week work is **Team + Services + Billing**, but the default landing is **Clinic profile** (letterhead), not the work that unblocks the floor.

On phone, group labels are hidden (`tab:block` only), so it is a **flat strip of seven chips** with no Clinic / People / System structure.

---

## Current information architecture

```text
Settings
├── Clinic
│   ├── Clinic profile     name, address, phone, email, walk-in ID prefix, logo
│   ├── Billing & invoicing  prefix, GST, FY month, billing on/off, who can bill, UPI
│   └── Partner & split    individual vs multiple, hasPartner, therapist splits, TDS
├── People & services
│   ├── Team               members, invite, service roster + linked login
│   └── Services           catalog table, inline price, add row
└── System
    ├── Features           expected today, clinical docs, therapist comparison
    └── Data & maintenance import Excel, backup/restore, reset cache, wipe
```

Also on the page (not a rail item): **First week** checklist, dismissed per device in Dexie (`firstWeekChecklistDismissed`).

---

## Section-by-section

### First week card

Useful, but it **sits above the whole page** and competes with the rail. After day one it is noise. Hide is per-device, so another admin on another PC sees it again (fine); on a reception PC it stays until someone hides it.

**Suggestion:** Collapse to a one-line “First week setup” that expands, or only show when checklist items are incomplete (unlinked therapists, empty catalog).

### Clinic profile

Clear and short. Walk-in ID prefix is the only “gotcha” field — correctly tipped.

**Friction:** Raw `Choose file` for logo, no preview of the current logo. Duplicate titles (rail + card + description line).

### Billing & invoicing

Two products in one card: **legal invoices** (prefix, GST, FY, who can bill) and **UPI collection**. Related, but the grid of On/Off + number-as-month + file upload is dense.

**Friction:**

- Fiscal year is `4` instead of “April”.
- Billing module Off/On is a clinic-wide nuke; it sits equal to Invoice prefix.
- UPI fields show even when “Show UPI QR” is Off.

### Partner & split (biggest IA miss)

**“Therapist setup: Individual vs Multiple” lives here**, next to hospital share %. A solo clinic looking for “I have one therapist” will not think “Partner.”

**Track therapist splits** is always visible, even for an individual clinic. Partner name/logo/% correctly hide until `hasPartner` is on — that pattern should apply to splits too.

TDS % is always shown; TDS basis only when partner + tax > 0. Good, but “Tax/TDS” next to “no partner” is still confusing.

### Team (densest, mostly justified)

Three stacks in one card: **Members → Invite → Service roster**. Necessary, but the roster’s “Linked login” is the #1 support failure and is a small dropdown at the end of a long row.

Invite is well designed (role chips, auto-roster for therapists).

**Suggestion:** Sub-tabs **Logins** | **Visit roster**, or put roster first when `unlinkedCount > 0`.

### Services

Immediate price edits (no Save bar) vs clinic forms that need Save. That inconsistency will make people think Services “didn’t save” or, worse, that Profile saved when it didn’t.

Table + add-row works on desktop; on phone it is a horizontal scroll.

### Features (thinnest page)

Three toggles that don’t share a story:

- Expected today → Workspace
- Clinical documentation → notes
- Therapist comparison → Reports

Plus a leftover line: *“Which Visits-table columns show is now a per-user choice…”* — that is not a setting; it is a footnote about somewhere else.

This tab does not earn a rail slot for most clinics.

### Data & maintenance

Right grouping. **Wipe** sitting under the same heading as **Import Excel** is still scary. Visual separation (rust button, extra confirm) is there; a collapsed “Advanced / destructive” disclosure would help.

---

## Recommended reorganisation

Keep **seven pieces of content**, but **five rail items** for daily use:

```text
People
  Team          ← default landing if unlinked; else Services if catalog empty; else Profile
  Services

Money
  Billing       ← invoices + UPI (UPI collapsed until enabled)
  Partner       ← hospital / share only; move clinic type to Team

Clinic
  Profile       ← letterhead

More            ← Features + Data, or keep Data separate at the bottom
```

Concrete moves:

1. **Default section:** Team if anyone is unlinked; otherwise **Services** in week one, **Profile** only after the clinic is named and priced. Today, unlinked already overrides to Team — keep that.
2. **Move “Individual / Multiple therapists” to Team** (or Profile as “This clinic”). Partner should mean **revenue share with a hospital/org**, not staffing.
3. **Hide “Track therapist splits” unless Multiple therapists.** Solo clinics should never see Split.
4. **Collapse Features into the places they affect**
   - Expected today → short note under Profile or a single “Workspace extras” row
   - Clinical notes → same
   - Comparison chart → Billing or Reports copy
   If you keep a Features tab, rename it **Optional modules** and drop the column-picker footnote.
5. **Billing: two visual blocks, progressive UPI**
   - Invoices (prefix, GST, FY as month name, who can bill, billing on/off at the bottom)
   - Collect via UPI (fields only when the toggle is On)
6. **Deep links:** `/settings?tab=team` (and `billing`, `services`) so Workspace “Setup: first week” and the unlinked banner can land on the right pane. Today the URL is always `/settings`.
7. **Phone:** show the three group labels in the horizontal scroller, or a compact **dropdown of sections** instead of seven equal chips.

---

## UI / UX polish (same IA, less friction)

| Issue | Change |
|--------|--------|
| Duplicate H1 + card title + description | One page title from the rail; drop the extra description or use it as the only subtitle |
| Seven rail accent colors | One selected state (teal), icons optional — Settings is admin chrome, not a rainbow |
| `confirm()` / `prompt()` / `alert()` | Same modal pattern as Edit visit / discard unsaved |
| File inputs | Preview current logo / UPI QR / partner logo; “Replace” |
| Fiscal year month | Select April…March, not `4` |
| Off/On pills | Fine; slightly larger hit target on phone |
| Catalog prices save instantly | Tiny “Saved” on the row, or explicit Save like other sections — pick one pattern |
| Dirty-dot + browser confirm | Keep; also warn on **browser back** |
| Roster “Linked login” | Full-width field on its own row; empty state: “This person cannot see Today until linked” |
| First week | Collapsed by default after first visit exists |

---

## What not to simplify away

- **Members vs roster** — real: locum without login, or login not yet linked. Don’t merge into one list without a clear “this name appears on visits” vs “this person can sign in.”
- **Wipe + type clinic name** — keep.
- **Price/split “future visits only”** copy — keep; it prevents support incidents.
- **Admin-only Settings** — keep.
- **Per-section Save** for clinic-row fields — keep (don’t go back to one giant form).

---

## Suggested build order

**Pass 1 — IA without new concepts:** Partner = hospital only; clinic type + splits on Team; UPI fields hidden until On; Features footnote gone; FY month names; logo preview.

**Pass 2 — Navigation:** `?tab=` deep links; default landing; phone section picker; collapse First week.

**Pass 3 — Density:** Merge Features into other tabs; Team sub-tabs Logins / Roster; catalog save feedback.

Do not restyle Settings into a different visual language from Workspace/Ledger — same paper, teal Save, rust for wipe.

---

## Related code

| Topic | Location |
|-------|----------|
| Settings shell, rail, sections | `src/features/settings/SettingsPage.tsx` |
| First week checklist | `src/features/settings/FirstWeekChecklist.tsx` |
| Admin nav filter | `src/app/Shell.tsx` |
| Permissions | `src/app/usePermissions.ts` |
| Clinic billing config (split flags) | `src/domain/types.ts` (`clinicBillingConfig`) |
| UPI settings | `src/domain/upiPay.ts`, Billing section in Settings |
