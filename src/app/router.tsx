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
const FeedbackFormPage = lazy(() =>
  import('@/features/publicFeedback/FeedbackFormPage').then((m) => ({ default: m.FeedbackFormPage }))
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

const newNoteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId/notes/new',
  validateSearch: (search: Record<string, unknown>): { visitId?: string } =>
    typeof search.visitId === 'string' ? { visitId: search.visitId } : {},
  component: NoteEditorPage,
});

const noteEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId/notes/$noteId',
  component: NoteEditorPage,
});

const notePrintRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId/notes/$noteId/print',
  component: NotePrintPage,
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

// Public, unauthenticated patient feedback link — see Shell.tsx's early
// bypass for this path (renders before the session/clinic gating below).
const feedbackFormRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/f/$token',
  component: FeedbackFormPage,
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
  noteEditorRoute,
  notePrintRoute,
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
  feedbackFormRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
