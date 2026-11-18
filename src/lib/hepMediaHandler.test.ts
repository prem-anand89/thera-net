// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { handleHepMedia, HEP_UPLOAD_CACHE_CONTROL, type HepMediaDeps } from '../../supabase/functions/_shared/hepMediaHandler';

function deps(over: Partial<HepMediaDeps> = {}): HepMediaDeps {
  return {
    isStaff: vi.fn(async () => true),
    publicHep: vi.fn(async () => ({ ok: true, clinicId: 'c-1', items: [{ id: 'i1', mediaKeys: ['clinics/c-1/exercises/ex-1/0'] }] })),
    ipAllowed: vi.fn(async () => true),
    r2Ready: () => true,
    mintGet: vi.fn(async (keys: string[]) => Object.fromEntries(keys.map((k) => [k, `https://signed.example/${k}`]))),
    mintPut: vi.fn(async (key: string) => `https://put.example/${key}`),
    hydrate: vi.fn(async (payload: { items: Array<{ mediaKeys?: string[]; [k: string]: unknown }> }, prefix: string) => ({
      ...payload,
      items: payload.items.map(({ mediaKeys, ...rest }) => ({ ...rest, mediaUrls: (mediaKeys ?? []).filter((k) => k.startsWith(prefix)).map((k) => `https://signed.example/${k}`) })),
    })),
    newSuffix: () => 'ab12cd34',
    isCurator: vi.fn(async () => true),
    copyObject: vi.fn(async () => {}),
    ...over,
  };
}

describe('hep-media: get_public_hep', () => {
  it('returns the page data with signed picture URLs and no raw keys after a good PIN', async () => {
    const r = await handleHepMedia({ action: 'get_public_hep', token: 'tok', pin: '1234' }, deps());
    expect(r.status).toBe(200);
    const item = (r.body.items as Array<Record<string, unknown>>)[0];
    expect(item.mediaKeys).toBeUndefined();
    expect(item.mediaUrls).toEqual(['https://signed.example/clinics/c-1/exercises/ex-1/0']);
  });

  it.each(['wrong_pin', 'locked', 'unavailable', 'pin_needed', 'busy'])('passes a %s result through with no clinic, program or picture data', async (reason) => {
    const d = deps({ publicHep: vi.fn(async () => ({ ok: false, reason, attemptsLeft: 2, clinicId: 'c-1', items: [{ title: 'secret' }] })) });
    const r = await handleHepMedia({ action: 'get_public_hep', token: 'tok', pin: '0000' }, d);
    expect(r.body).toEqual({ ok: false, reason, attemptsLeft: 2 });
    expect(d.mintGet).not.toHaveBeenCalled();
    expect(d.hydrate).not.toHaveBeenCalled();
  });

  it('answers 429 and never reaches the database when the IP is over its limit', async () => {
    const d = deps({ ipAllowed: vi.fn(async () => false) });
    const r = await handleHepMedia({ action: 'get_public_hep', token: 'tok', pin: '1234' }, d);
    expect(r).toEqual({ status: 429, body: { ok: false, reason: 'busy' } });
    expect(d.publicHep).not.toHaveBeenCalled();
  });

  it('passes the remembered-phone token, program id and the refresh reason through', async () => {
    const d = deps();
    await handleHepMedia({ action: 'get_public_hep', token: 'tok', device: 'dev1', programId: 'p-1', reason: 'refresh' }, d);
    expect(d.publicHep).toHaveBeenCalledWith({ token: 'tok', pin: null, device: 'dev1', programId: 'p-1', reason: 'refresh' });
    await handleHepMedia({ action: 'get_public_hep', token: 'tok', pin: '1234', reason: 'anything else' }, d);
    expect((d.publicHep as ReturnType<typeof vi.fn>).mock.calls[1][0].reason).toBe('open');
  });

  it('only signs keys inside the payload clinic (a foreign key is dropped)', async () => {
    const d = deps({ publicHep: vi.fn(async () => ({ ok: true, clinicId: 'c-1', items: [{ id: 'i1', mediaKeys: ['clinics/c-2/exercises/x/0'] }] })) });
    const r = await handleHepMedia({ action: 'get_public_hep', token: 'tok', pin: '1234' }, d);
    expect((r.body.items as Array<Record<string, unknown>>)[0].mediaUrls).toEqual([]);
  });

  it('when R2 is not configured the patient still gets the text, with no keys and no pictures', async () => {
    const d = deps({ r2Ready: () => false });
    const r = await handleHepMedia({ action: 'get_public_hep', token: 'tok', pin: '1234' }, d);
    expect(r.status).toBe(200);
    expect((r.body.items as Array<Record<string, unknown>>)[0]).toEqual({ id: 'i1', mediaUrls: [] });
    expect(d.hydrate).not.toHaveBeenCalled();
  });

  it('rejects a missing token', async () => {
    expect((await handleHepMedia({ action: 'get_public_hep' }, deps())).status).toBe(400);
  });
});

describe('hep-media: staff actions', () => {
  it('mint_upload_urls: the server picks the keys (new suffix each time) and signs the cache header', async () => {
    const d = deps();
    const r = await handleHepMedia({ action: 'mint_upload_urls', clinicId: 'c-1', exerciseId: 'ex-1', slots: [0, 1, 'thumb'] }, d);
    expect(r.status).toBe(200);
    const uploads = r.body.uploads as Array<{ slot: unknown; key: string; url: string; headers: Record<string, string> }>;
    expect(uploads.map((u) => u.key)).toEqual([
      'clinics/c-1/exercises/ex-1/0-ab12cd34',
      'clinics/c-1/exercises/ex-1/1-ab12cd34',
      'clinics/c-1/exercises/ex-1/thumb-ab12cd34',
    ]);
    expect(uploads[0].headers['Cache-Control']).toBe(HEP_UPLOAD_CACHE_CONTROL);
  });

  it('refuses everything for someone who is not clinical staff of that clinic, without signing anything', async () => {
    const d = deps({ isStaff: vi.fn(async () => false) });
    for (const body of [
      { action: 'mint_upload_urls', clinicId: 'c-1', exerciseId: 'ex-1', slots: [0] },
      { action: 'mint_view_urls', clinicId: 'c-1', keys: ['clinics/c-1/exercises/ex-1/0'] },
    ]) {
      expect((await handleHepMedia(body, d)).status).toBe(403);
    }
    expect(d.mintPut).not.toHaveBeenCalled();
    expect(d.mintGet).not.toHaveBeenCalled();
  });

  it('mint_view_urls: signs only keys inside the caller\'s own clinic and refuses a mixed list', async () => {
    const d = deps();
    const ok = await handleHepMedia({ action: 'mint_view_urls', clinicId: 'c-1', keys: ['clinics/c-1/exercises/ex-1/0', 'clinics/c-1/exercises/ex-1/thumb-ab12cd34'] }, d);
    expect(ok.status).toBe(200);
    expect(Object.keys(ok.body.urls as object)).toHaveLength(2);
    const mixed = await handleHepMedia({ action: 'mint_view_urls', clinicId: 'c-1', keys: ['clinics/c-1/exercises/ex-1/0', 'clinics/c-2/exercises/ex-1/0'] }, d);
    expect(mixed.status).toBe(403);
    const tricky = await handleHepMedia({ action: 'mint_view_urls', clinicId: 'c-1', keys: ['clinics/c-1/exercises/../c-2/exercises/ex-1/0'] }, d);
    expect(tricky.status).toBe(403);
  });

  it('validates the request shape (slots, counts, ids)', async () => {
    const d = deps();
    const bad = [
      { action: 'mint_upload_urls', clinicId: 'c-1', exerciseId: 'ex-1', slots: [] },
      { action: 'mint_upload_urls', clinicId: 'c-1', exerciseId: 'ex-1', slots: [4] },
      { action: 'mint_upload_urls', clinicId: 'c-1', exerciseId: 'ex/1', slots: [0] },
      { action: 'mint_upload_urls', clinicId: 'c-1', exerciseId: 'ex-1', slots: [0, 1, 2, 3, 'thumb', 0] },
      { action: 'mint_view_urls', clinicId: 'c-1', keys: [] },
      { action: 'mint_view_urls', clinicId: 'c-1', keys: Array.from({ length: 61 }, (_, i) => `clinics/c-1/exercises/ex-1/${i % 4}`) },
      { action: 'nope' },
      null,
      'text',
    ];
    for (const b of bad) expect((await handleHepMedia(b, d)).status).toBe(400);
    expect(d.isStaff).not.toHaveBeenCalled();
  });

  it('answers 503 for staff actions when R2 is not configured', async () => {
    const d = deps({ r2Ready: () => false });
    expect((await handleHepMedia({ action: 'mint_upload_urls', clinicId: 'c-1', exerciseId: 'ex-1', slots: [0] }, d)).status).toBe(503);
  });

  it('mint_starter_view_urls: signs starter keys for clinic staff and rejects non-starter keys', async () => {
    const d = deps();
    const ok = await handleHepMedia({ action: 'mint_starter_view_urls', clinicId: 'c-1', keys: ['starter/exercises/st-1/1-ab12cd34'] }, d);
    expect(ok.status).toBe(200);
    expect(ok.body.urls).toEqual({ 'starter/exercises/st-1/1-ab12cd34': 'https://signed.example/starter/exercises/st-1/1-ab12cd34' });
    const bad = await handleHepMedia({ action: 'mint_starter_view_urls', clinicId: 'c-1', keys: ['clinics/c-2/exercises/ex-1/0'] }, d);
    expect(bad.status).toBe(403);
  });

  it('clone_to_starter: copies clinic keys into starter/exercises only for curator clinics', async () => {
    const d = deps();
    const r = await handleHepMedia({
      action: 'clone_to_starter',
      clinicId: 'c-1',
      starterId: 'st-1',
      mediaKeys: ['clinics/c-1/exercises/ex-1/0-aaaaaaaa', 'clinics/c-1/exercises/ex-1/1-bbbbbbbb'],
      thumbKey: 'clinics/c-1/exercises/ex-1/thumb-cccccccc',
    }, d);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      mediaKeys: ['starter/exercises/st-1/0-ab12cd34', 'starter/exercises/st-1/1-ab12cd34'],
      thumbKey: 'starter/exercises/st-1/thumb-ab12cd34',
    });
    expect(d.copyObject).toHaveBeenCalledTimes(3);

    const nonCurator = deps({ isCurator: vi.fn(async () => false) });
    expect((await handleHepMedia({
      action: 'clone_to_starter', clinicId: 'c-1', starterId: 'st-1', mediaKeys: ['clinics/c-1/exercises/ex-1/0-aaaaaaaa'],
    }, nonCurator)).status).toBe(403);
  });

  it('clone_from_starter: copies starter keys into the receiving clinic folder', async () => {
    const d = deps();
    const r = await handleHepMedia({
      action: 'clone_from_starter',
      clinicId: 'c-2',
      exerciseId: 'ex-9',
      mediaKeys: ['starter/exercises/st-1/0-aaaaaaaa'],
      thumbKey: 'starter/exercises/st-1/thumb-cccccccc',
    }, d);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      mediaKeys: ['clinics/c-2/exercises/ex-9/0-ab12cd34'],
      thumbKey: 'clinics/c-2/exercises/ex-9/thumb-ab12cd34',
    });
    expect(d.copyObject).toHaveBeenCalledWith('starter/exercises/st-1/0-aaaaaaaa', 'clinics/c-2/exercises/ex-9/0-ab12cd34');
  });
});
