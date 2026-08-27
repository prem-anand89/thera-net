import { lazy } from 'react';
import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import { Shell } from './Shell';
import { WorkspacePage } from '@/features/workspace/WorkspacePage';

// Code-split every route except the default post-login landing page
// (Workspace) — that one stays eager so the most common path pays no extra
// chunk fetch. Everything else (ledger, insights, print pages, the Excel
// import UI, settings) only loads when actually visited.
const NewVisitPage = lazy(() =>
  import('@/features/visits/NewVisitPage').then((m) => ({ default: m.NewVisitPage }))
);
const LedgerPage = lazy(() =>
  import('@/features/visits/LedgerPage').then((m) => ({ default: m.LedgerPage }))
);
const PatientsPage = lazy(() =>
  import('@/features/patients/PatientsPage').then((m) => ({ default: m.PatientsPage }))
);
const PatientProfilePage = lazy(() =>
  import('@/features/patients/PatientProfilePage').then((m) => ({ default: m.PatientProfilePage }))
);
const NoteEditorPage = lazy(() =>
  import('@/features/patients/NoteEditorPage').then((m) => ({ default: m.NoteEditorPage }))
);
const SessionNoteEditorPage = lazy(() =>
  import('@/features/patients/SessionNoteEditorPage').then((m) => ({
    default: m.SessionNoteEditorPage,
  }))
);
const NoteEditorDispatch = lazy(() =>
  import('@/features/patients/NoteEditorDispatch').then((m) => ({ default: m.NoteEditorDispatch }))
);
const SessionLogPrintPage = lazy(() =>
  import('@/features/patients/SessionLogPrintPage').then((m) => ({
    default: m.SessionLogPrintPage,
  }))
);
const InsurerPacketPage = lazy(() =>
  import('@/features/patients/InsurerPacketPage').then((m) => ({
    default: m.InsurerPacketPage,
  }))
);
const MonthlyLedgerPrintPage = lazy(() =>
  import('@/features/reports/MonthlyLedgerPrintPage').then((m) => ({
    default: m.MonthlyLedgerPrintPage,
  }))
);
const InvoicePrintPage = lazy(() =>
  import('@/features/invoices/InvoicePrintPage').then((m) => ({ default: m.InvoicePrintPage }))
);
const NotePrintPage = lazy(() =>
  import('@/features/patients/NotePrintPage').then((m) => ({ default: m.NotePrintPage }))
);
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage }))
);
const ImportVisitsPage = lazy(() =>
  import('@/features/import/ImportVisitsPage').then((m) => ({ default: m.ImportVisitsPage }))
);
const ReportsPage = lazy(() =>
  import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const MorePage = lazy(() =>
  import('@/features/more/MorePage').then((m) => ({ default: m.MorePage }))
);
const ResetPasswordPage = lazy(() =>
  import('@/features/auth/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage }))
);

const rootRoute = createRootRoute({ component: Shell });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/workspace' });
  },
});

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspace',
  component: WorkspacePage,
});

const LEDGER_TABS = ['visits', 'invoices'] as const;

const ledgerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ledger',
  validateSearch: (
    search: Record<string, unknown>
  ): { patientId?: string; tab?: (typeof LEDGER_TABS)[number] } => ({
    ...(typeof search.patientId === 'string' ? { patientId: search.patientId } : {}),
    ...(LEDGER_TABS.includes(search.tab as (typeof LEDGER_TABS)[number])
      ? { tab: search.tab as (typeof LEDGER_TABS)[number] }
      : {}),
  }),
  component: LedgerPage,
});

// Permanent redirect, not a 404 — preserves patientId for existing
// bookmarks/shared links pointing at the old path.
const archiveRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/archive',
  validateSearch: (search: Record<string, unknown>): { patientId?: string } =>
    typeof search.patientId === 'string' ? { patientId: search.patientId } : {},
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/ledger', search });
  },
});

const newVisitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/visits/new',
  validateSearch: (
    search: Record<string, unknown>
  ): { repeatVisitId?: string; newPatient?: string; patientId?: string; prefillName?: string } => ({
    ...(typeof search.repeatVisitId === 'string' ? { repeatVisitId: search.repeatVisitId } : {}),
    ...(typeof search.newPatient === 'string' ? { newPatient: search.newPatient } : {}),
    ...(typeof search.patientId === 'string' ? { patientId: search.patientId } : {}),
    ...(typeof search.prefillName === 'string' ? { prefillName: search.prefillName } : {}),
  }),
  component: NewVisitPage,
});

const patientsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients',
  component: PatientsPage,
});

const PATIENT_PROFILE_BACK_TARGETS = ['/patients', '/workspace', '/ledger'] as const;
export type PatientProfileBackTarget = (typeof PATIENT_PROFILE_BACK_TARGETS)[number];

const patientProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId',
  // Where "← Back" should return to — set by whichever screen linked here
  // (Patients list, Workspace, Ledger) so it doesn't always land on one
  // fixed page regardless of where the visitor came from.
  validateSearch: (search: Record<string, unknown>): { from?: PatientProfileBackTarget } =>
    PATIENT_PROFILE_BACK_TARGETS.includes(search.from as PatientProfileBackTarget)
      ? { from: search.from as PatientProfileBackTarget }
      : {},
  component: PatientProfilePage,
});

// Same "← Back" context-carrying as the patient profile route itself, one
// hop further out: a note/print screen is always reached via the patient
// profile, so it needs to forward the same `from` the profile got, or the
// profile's own "← Back" link has nothing to return to once the user comes
// back from the note and clicks it again — falling back to the bare
// patient list instead of wherever they actually started (Ledger,
// Workspace, Patients).
const validateFromSearch = (
  search: Record<string, unknown>
): { from?: PatientProfileBackTarget } =>
  PATIENT_PROFILE_BACK_TARGETS.includes(search.from as PatientProfileBackTarget)
    ? { from: search.from as PatientProfileBackTarget }
    : {};

// Shared by both note routes: `visitId` (only meaningful as "add a note for
// this specific visit") survives the redirect from "start a new note" to an
// already-open draft (NoteEditorPage.tsx re-navigates to noteEditorRoute in
// that case, carrying it along), so noteEditorRoute needs to accept it too,
// not just newNoteRoute.
const validateNoteSearch = (
  search: Record<string, unknown>
): { visitId?: string; from?: PatientProfileBackTarget } => ({
  ...(typeof search.visitId === 'string' ? { visitId: search.visitId } : {}),
  ...validateFromSearch(search),
});

// 'needs-initial': set when a visit-row "+ Note" link wanted the light
// session editor but sessionNotesAllowed was false (no completed initial
// assessment yet for the enrollment) — tells the heavy editor to show a
// banner explaining the redirect. Deliberately its own explicit param
// rather than inferred from `from` (a legitimate follow-up opened via
// Ledger/Workspace also carries `from` and must not show the banner).
const NEW_NOTE_REASONS = ['needs-initial'] as const;
type NewNoteReason = (typeof NEW_NOTE_REASONS)[number];

const newNoteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId/notes/new',
  validateSearch: (
    search: Record<string, unknown>
  ): { visitId?: string; from?: PatientProfileBackTarget; reason?: NewNoteReason } => ({
    ...validateNoteSearch(search),
    ...(NEW_NOTE_REASONS.includes(search.reason as NewNoteReason)
      ? { reason: search.reason as NewNoteReason }
      : {}),
  }),
  component: NoteEditorPage,
});

// The light per-visit SOAP note's own entry point — a distinct path rather
// than a query param on /notes/new, since the two "new note" callers
// already differ (one always carries visitId, the other doesn't; only this
// one is gated on sessionNotesAllowed before the link is ever offered).
const newSessionNoteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId/notes/new-session',
  validateSearch: validateNoteSearch,
  component: SessionNoteEditorPage,
});

// Dispatches to the heavy or light editor based on the note's own
// noteMode — see NoteEditorDispatch.tsx.
const noteEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId/notes/$noteId',
  validateSearch: validateNoteSearch,
  component: NoteEditorDispatch,
});

const notePrintRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId/notes/$noteId/print',
  validateSearch: validateFromSearch,
  component: NotePrintPage,
});

// Multi-visit session log (C6) — one enrollment's completed session notes,
// the only print surface for session-note content.
const sessionLogPrintRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId/session-log/$enrollmentId',
  validateSearch: validateFromSearch,
  component: SessionLogPrintPage,
});

// Insurer packet (C7) — assessment + session log + read-only invoice(s)
// composed in one print job for this enrollment.
const insurerPacketRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId/insurer-packet/$enrollmentId',
  validateSearch: validateFromSearch,
  component: InsurerPacketPage,
});

// The monthly statement lives under the Reports nav tab (/insights), not
// Ledger — see ReportsPage.tsx. This standalone route becomes a redirect
// rather than a hard delete-to-404: nothing in the app links here anymore,
// but an external bookmark or shared link might, and there's no way to be
// certain none exist.
const monthlyPrintSearch = (search: Record<string, unknown>): { year: number; month: number } => ({
  year: Number(search.year) || new Date().getFullYear(),
  month: Number(search.month) || new Date().getMonth() + 1,
});

// Monthly statement PDF/print view — lives under /insights (Reports nav) so
// TanStack Router <Link> doesn't resolve /reports/print through the /reports
// bookmark redirect (which sent Export as PDF back to Trends).
const insightsPrintRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/insights/print',
  validateSearch: monthlyPrintSearch,
  component: MonthlyLedgerPrintPage,
});

const reportsRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  beforeLoad: () => {
    throw redirect({ to: '/insights', search: { tab: 'monthly' } });
  },
});

const reportsPrintRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports/print',
  validateSearch: monthlyPrintSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/insights/print', search });
  },
});

const INVOICE_PRINT_BACK_TARGETS = ['/ledger', '/workspace'] as const;
export type InvoicePrintBackTarget = (typeof INVOICE_PRINT_BACK_TARGETS)[number];

const invoicePrintRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invoices/$invoiceId/print',
  // Same "← Back" context-carrying as the patient profile route — this
  // print page is reachable from both Ledger and Workspace. `tab` additionally
  // carries which Ledger sub-tab to return to (only 'invoices' is meaningful
  // here — 'visits' is Ledger's default, so absence already means that).
  validateSearch: (
    search: Record<string, unknown>
  ): { from?: InvoicePrintBackTarget; tab?: 'invoices' } => ({
    ...(INVOICE_PRINT_BACK_TARGETS.includes(search.from as InvoicePrintBackTarget)
      ? { from: search.from as InvoicePrintBackTarget }
      : {}),
    ...(search.tab === 'invoices' ? { tab: 'invoices' as const } : {}),
  }),
  component: InvoicePrintPage,
});

// Kept in sync with SettingsPage's own SectionKey by hand — a route file
// shouldn't import a feature's internal type just to validate a search
// param, and the two rarely change.
const SETTINGS_TABS = [
  'plan',
  'profile',
  'billing',
  'partner',
  'team',
  'services',
  'treatments',
  'referrals',
  'data',
] as const;

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  validateSearch: (search: Record<string, unknown>): { tab?: (typeof SETTINGS_TABS)[number] } =>
    typeof search.tab === 'string' && (SETTINGS_TABS as readonly string[]).includes(search.tab)
      ? { tab: search.tab as (typeof SETTINGS_TABS)[number] }
      : {},
  component: SettingsPage,
});

const setupRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  beforeLoad: () => {
    throw redirect({ to: '/settings' });
  },
});

const importVisitsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/import-visits',
  component: ImportVisitsPage,
});

const importVisitsRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup/import-visits',
  beforeLoad: () => {
    throw redirect({ to: '/settings/import-visits' });
  },
});

// Nav label is "Reports" (renamed from "Insights") — path stays /insights
// since /reports is already the monthly-statement redirect above and can't
// be reused. Same rename-only-where-it-matters pattern as LedgerPage/
// SettingsPage: the label people see changed, the URL didn't need to.
const insightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/insights',
  validateSearch: (
    search: Record<string, unknown>
  ): { tab?: 'monthly' | 'audit'; year?: number; month?: number } => ({
    ...(search.tab === 'monthly' || search.tab === 'audit' ? { tab: search.tab } : {}),
    ...(typeof search.year === 'number' && typeof search.month === 'number'
      ? { year: search.year, month: search.month }
      : {}),
  }),
  component: ReportsPage,
});

// Invoices moved fully under Ledger as a sub-view — redirect rather than
// delete, since nothing in the app links here anymore but an external
// bookmark or shared link might. Lands on the Visits tab instead if the
// viewer can't bill (LedgerPage.tsx resets an invalid `tab` — same guard
// PR 13 added for invoicingAccess changing mid-session).
const invoicesRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invoices',
  beforeLoad: () => {
    throw redirect({ to: '/ledger', search: { tab: 'invoices' } });
  },
});

const moreRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/more',
  component: MorePage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: ResetPasswordPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  workspaceRoute,
  ledgerRoute,
  archiveRedirectRoute,
  newVisitRoute,
  patientsRoute,
  patientProfileRoute,
  newNoteRoute,
  newSessionNoteRoute,
  noteEditorRoute,
  notePrintRoute,
  sessionLogPrintRoute,
  insurerPacketRoute,
  insightsPrintRoute,
  reportsRedirectRoute,
  reportsPrintRedirectRoute,
  invoicePrintRoute,
  invoicesRedirectRoute,
  settingsRoute,
  setupRedirectRoute,
  importVisitsRoute,
  importVisitsRedirectRoute,
  insightsRoute,
  moreRoute,
  resetPasswordRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
