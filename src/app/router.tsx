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
// chunk fetch. Everything else (archive, insights, print pages, the Excel
// import UI, setup) only loads when actually visited.
const NewVisitPage = lazy(() =>
  import('@/features/visits/NewVisitPage').then((m) => ({ default: m.NewVisitPage }))
);
const ArchivePage = lazy(() =>
  import('@/features/visits/VisitsPage').then((m) => ({ default: m.VisitsPage }))
);
const PatientProfilePage = lazy(() =>
  import('@/features/patients/PatientProfilePage').then((m) => ({ default: m.PatientProfilePage }))
);
const ReportsPage = lazy(() =>
  import('@/features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage }))
);
const MonthlyLedgerPrintPage = lazy(() =>
  import('@/features/reports/MonthlyLedgerPrintPage').then((m) => ({
    default: m.MonthlyLedgerPrintPage,
  }))
);
const InvoicePrintPage = lazy(() =>
  import('@/features/invoices/InvoicePrintPage').then((m) => ({ default: m.InvoicePrintPage }))
);
const SetupPage = lazy(() =>
  import('@/features/setup/SetupPage').then((m) => ({ default: m.SetupPage }))
);
const ImportVisitsPage = lazy(() =>
  import('@/features/import/ImportVisitsPage').then((m) => ({ default: m.ImportVisitsPage }))
);
const InsightsPage = lazy(() =>
  import('@/features/insights/InsightsPage').then((m) => ({ default: m.InsightsPage }))
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

const archiveRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/archive',
  validateSearch: (search: Record<string, unknown>): { patientId?: string } =>
    typeof search.patientId === 'string' ? { patientId: search.patientId } : {},
  component: ArchivePage,
});

const newVisitRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/visits/new',
  validateSearch: (search: Record<string, unknown>): { repeatVisitId?: string; newPatient?: string } => ({
    ...(typeof search.repeatVisitId === 'string' ? { repeatVisitId: search.repeatVisitId } : {}),
    ...(typeof search.newPatient === 'string' ? { newPatient: search.newPatient } : {}),
  }),
  component: NewVisitPage,
});

const patientProfileRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/patients/$patientId',
  component: PatientProfilePage,
});

const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: ReportsPage,
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

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: SetupPage,
});

const importVisitsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup/import-visits',
  component: ImportVisitsPage,
});

const insightsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/insights',
  component: InsightsPage,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: ResetPasswordPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  workspaceRoute,
  archiveRoute,
  newVisitRoute,
  patientProfileRoute,
  reportsRoute,
  reportsPrintRoute,
  invoicePrintRoute,
  setupRoute,
  importVisitsRoute,
  insightsRoute,
  resetPasswordRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
