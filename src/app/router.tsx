import { lazy } from 'react';
import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from '@tanstack/react-router';
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
  validateSearch: (search: Record<string, unknown>): { patientId?: string; tab?: (typeof LEDGER_TABS)[number] } => ({
    ...(typeof search.patientId === 'string' ? { patientId: search.patientId } : {}),
    ...(LEDGER_TABS.includes(search.tab as (typeof LEDGER_TABS)[number]) ? { tab: search.tab as (typeof LEDGER_TABS)[number] } : {}),
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

const patientProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId',
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

// The monthly statement lives under the Reports nav tab (/insights), not
// Ledger — see ReportsPage.tsx. This standalone route becomes a redirect
// rather than a hard delete-to-404: nothing in the app links here anymore,
// but an external bookmark or shared link might, and there's no way to be
// certain none exist.
const reportsRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  beforeLoad: () => {
    throw redirect({ to: '/insights', search: { tab: 'monthly' } });
  },
});

const reportsPrintRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports/print',
  validateSearch: (search: Record<string, unknown>): { year: number; month: number } => ({
    year: Number(search.year) || new Date().getFullYear(),
    month: Number(search.month) || new Date().getMonth() + 1,
  }),
  component: MonthlyLedgerPrintPage,
});

const invoicePrintRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/invoices/$invoiceId/print',
  component: InvoicePrintPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
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
  validateSearch: (search: Record<string, unknown>): { tab?: 'monthly' } =>
    search.tab === 'monthly' ? { tab: 'monthly' } : {},
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
  noteEditorRoute,
  reportsRedirectRoute,
  reportsPrintRoute,
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
