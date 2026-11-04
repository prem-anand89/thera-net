import { describe, expect, it, vi } from 'vitest';
import type { CatalogItem, ReferringSourceItem, TreatmentItem } from '@/domain/types';
import type { Repos } from '@/repositories/types';
import { NameTakenError } from '@/domain/nameCheck';
import { createCatalogService } from './catalogService';

vi.mock('@/lib/supabase', () => ({ getSupabase: () => null }));

const now = '2026-11-03T00:00:00Z';
const svc = (over: Partial<CatalogItem>): CatalogItem => ({
  id: crypto.randomUUID(), clinicId: 'c1', category: 'Consultation', name: 'Initial assessment', sessionCount: 1,
  basePricePaise: 100000, active: true, updatedAt: now, ...over,
});

function setup(services: CatalogItem[] = [], treatments: TreatmentItem[] = [], sources: ReferringSourceItem[] = [], visits: unknown[] = [], lines: unknown[] = []) {
  const puts = { catalog: vi.fn(), bulk: vi.fn(), treatment: vi.fn(), source: vi.fn() };
  const repos = {
    catalog: { list: async () => services, put: async (i: CatalogItem) => puts.catalog(i), bulkPut: async (rows: CatalogItem[]) => puts.bulk(rows) },
    visits: { list: async () => visits },
    visitItems: { listByClinic: async () => lines },
    treatmentCatalog: { list: async () => treatments, put: async (i: TreatmentItem) => puts.treatment(i) },
    referringSourceCatalog: { list: async () => sources, put: async (i: ReferringSourceItem) => puts.source(i) },
  } as unknown as Repos;
  return { service: createCatalogService(repos), puts };
}

describe('catalogService name checks (the safety net under every form)', () => {
  it('refuses a service name that exists, capitals ignored, before writing anything', async () => {
    const { service, puts } = setup([svc({})]);
    await expect(service.addService(svc({ name: 'INITIAL ASSESSMENT' }))).rejects.toThrow('You already have Initial assessment.');
    expect(puts.catalog).not.toHaveBeenCalled();
  });

  it('refuses the name of a stopped service and says where it is', async () => {
    const { service, puts } = setup([svc({ name: 'Dry Needling', active: false })]);
    await expect(service.addService(svc({ name: 'dry needling' }))).rejects.toThrow('Dry Needling is inactive.');
    expect(puts.catalog).not.toHaveBeenCalled();
  });

  it('saves an edit under its own unchanged name, and a near match', async () => {
    const own = svc({});
    const { service, puts } = setup([own]);
    await service.updateService({ ...own, basePricePaise: 120000 });
    await service.addService(svc({ name: 'Initial assessments' }));
    expect(puts.catalog).toHaveBeenCalledTimes(2);
  });

  it('puts a service typed into an existing group with other capitals into that group', async () => {
    const { service, puts } = setup([svc({ category: 'Consultation' })]);
    await service.addService(svc({ name: 'Follow-up', category: 'consultation ' }));
    expect(puts.catalog.mock.calls[0][0]).toMatchObject({ category: 'Consultation', name: 'Follow-up' });
  });

  it('refuses a duplicate treatment and a duplicate referral source before writing', async () => {
    const { service, puts } = setup(
      [],
      [{ id: 't1', clinicId: 'c1', name: 'Manual Therapy', active: true, updatedAt: now }],
      [{ id: 'r1', clinicId: 'c1', name: 'Walk-in', detailLabel: null, active: false, updatedAt: now }]
    );
    await expect(service.addTreatment({ id: 't2', clinicId: 'c1', name: 'manual therapy', active: true, updatedAt: now })).rejects.toThrow(NameTakenError);
    await expect(service.addReferralSource({ id: 'r2', clinicId: 'c1', name: 'WALK-IN', detailLabel: null, active: true, updatedAt: now })).rejects.toThrow('Walk-in is hidden.');
    await expect(service.updateTreatment({ id: 't1', clinicId: 'c1', name: 'Manual Therapy', active: true, updatedAt: now })).resolves.toBeUndefined();
    expect(puts.treatment).toHaveBeenCalledTimes(1);
    expect(puts.source).not.toHaveBeenCalled();
  });

  it('first-run setup: a name twice in the batch, or one already in the clinic, writes nothing at all', async () => {
    const a = setup([]);
    await expect(a.service.addServices([svc({ name: 'Session' }), svc({ name: 'session' })])).rejects.toThrow(NameTakenError);
    expect(a.puts.catalog).not.toHaveBeenCalled();
    const b = setup([svc({ name: 'Session' })]);
    await expect(b.service.addServices([svc({ name: 'Package' }), svc({ name: 'SESSION' })])).rejects.toThrow(NameTakenError);
    expect(b.puts.catalog).not.toHaveBeenCalled();
    const c = setup([]);
    await c.service.addServices([svc({ name: 'Session' }), svc({ name: 'Package' })]);
    expect(c.puts.catalog).toHaveBeenCalledTimes(2);
  });

  it('addServices re-saves rows it already holds ("← Edit services" in onboarding) instead of calling them taken', async () => {
    const existing = svc({ id: 's-1', name: 'Session', basePricePaise: 50000 });
    const d = setup([existing]);
    await d.service.addServices([{ ...existing, basePricePaise: 60000 }]);
    expect(d.puts.catalog).toHaveBeenCalledWith(expect.objectContaining({ id: 's-1', basePricePaise: 60000 }));
  });
});

describe('catalogService groups and usage', () => {
  it('renames a group in one write, joining an existing group typed with other capitals', async () => {
    const a = svc({ category: 'Consult' }), b = svc({ name: 'B', category: 'Consult' }), c = svc({ name: 'C', category: 'Consultation' });
    const { service, puts } = setup([a, b, c]);
    await expect(service.renameGroup('c1', 'Consult', 'consultation')).resolves.toBe('Consultation');
    expect(puts.bulk).toHaveBeenCalledTimes(1);
    expect(puts.bulk.mock.calls[0][0].map((i: CatalogItem) => [i.name, i.category])).toEqual([
      ['Initial assessment', 'Consultation'],
      ['B', 'Consultation'],
    ]);
    expect(puts.catalog).not.toHaveBeenCalled();
  });

  it('refuses a blank group name, and removing a group ungroups its services in one write', async () => {
    const a = svc({ category: 'Consultation' });
    const { service, puts } = setup([a, svc({ name: 'Other', category: 'Physio' })]);
    await expect(service.renameGroup('c1', 'Consultation', '  ')).rejects.toThrow('Group name is required');
    await service.removeGroup('c1', 'Consultation');
    expect(puts.bulk).toHaveBeenCalledTimes(1);
    expect(puts.bulk.mock.calls[0][0]).toEqual([expect.objectContaining({ id: a.id, category: '' })]);
  });

  it('counts each visit once per service, from its lines or (older visits) its own service', async () => {
    const visits = [
      { id: 'v1', serviceCatalogId: 's1' },
      { id: 'v2', serviceCatalogId: 's1' },
      { id: 'v3', serviceCatalogId: 's2' },
    ];
    const lines = [
      { visitId: 'v1', serviceCatalogId: 's1', deleted: false },
      { visitId: 'v1', serviceCatalogId: 's1', deleted: false },
      { visitId: 'v1', serviceCatalogId: 's3', deleted: false },
      { visitId: 'v2', serviceCatalogId: 's3', deleted: true },
    ];
    const { service } = setup([], [], [], visits, lines);
    const counts = await service.usageCounts('c1');
    expect(Object.fromEntries(counts)).toEqual({ s1: 2, s2: 1, s3: 1 });
  });
});

