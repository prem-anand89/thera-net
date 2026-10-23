// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Visit } from '@/domain/types';
import type { TodayVisitRow } from '@/services/dashboardService';

vi.mock('@/services', () => ({ repos: {}, visitService: {}, dashboardService: {} }));

import { visitToCardData } from './LedgerPage';
import { todayRowToCardData } from '@/features/workspace/WorkspacePage';

type Role = { isAdmin: boolean; isFrontDesk: boolean; myTherapistId: string | undefined };
const admin: Role = { isAdmin: true, isFrontDesk: false, myTherapistId: undefined };
const frontDesk: Role = { isAdmin: false, isFrontDesk: true, myTherapistId: undefined };
const primary: Role = { isAdmin: false, isFrontDesk: false, myTherapistId: 'p' };
const assisting: Role = { isAdmin: false, isFrontDesk: false, myTherapistId: 's' };

function ledger(role: Role, invoiced = false) {
  const v = {
    id: 'v1', patientId: 'pt', therapistId: 'p', visitDate: '2026-10-20', serviceCatalogId: 'a',
    actualBillPaise: 100000, invoiceId: invoiced ? 'inv' : null, clinicalStatus: null,
  } as unknown as Visit;
  return visitToCardData(
    v, new Map(), new Map(), new Map(), new Map(), new Map(), new Map(), new Set(), true,
    new Map(), new Map(), new Map(), role.isAdmin, role.isFrontDesk, role.myTherapistId,
    true, new Set(), undefined, false, new Map(), new Map(), new Set(), null
  );
}
function today(role: Role, invoiced = false) {
  const row = {
    visitId: 'v1', patientId: 'pt', patientName: 'A', mrno: 'M', therapistId: 'p', billPaise: 100000,
    invoiceId: invoiced ? 'inv' : null, treatmentIds: [], needsNote: false,
  } as unknown as TodayVisitRow;
  return todayRowToCardData(
    row, new Set(), role.isAdmin, role.isFrontDesk, role.myTherapistId, true, true, new Map(),
    new Set(), undefined, false, new Map(), new Map(), new Set(), null
  );
}

describe.each([
  ['Ledger', ledger],
  ['Workspace', today],
])('%s row actions by role', (_name, build) => {
  it('front desk can edit and split a saved visit but not delete it', () => {
    expect(build(frontDesk)).toMatchObject({ canEdit: true, canSplit: true, canDelete: false });
  });
  it('an assisting therapist gets no edit, split or delete', () => {
    expect(build(assisting)).toMatchObject({ canEdit: false, canSplit: false, canDelete: false });
  });
  it('the primary therapist and admin can delete until the visit is invoiced', () => {
    expect(build(primary)).toMatchObject({ canEdit: true, canDelete: true });
    expect(build(admin)).toMatchObject({ canEdit: true, canDelete: true });
    expect(build(primary, true)).toMatchObject({ canEdit: true, canDelete: false });
  });
});
