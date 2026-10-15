// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { db } from '@/lib/db';
import type { Clinic } from '@/domain/types';
import { resolveActiveClinic, setActiveClinic, useActiveClinic } from './useActiveClinic';

const c = (id: string) => ({ id, name: id.toUpperCase() }) as Clinic;

describe('resolveActiveClinic', () => {
  it('is loading while either query is unresolved (undefined), never "pointer missing"', () => {
    expect(resolveActiveClinic(undefined, undefined).status).toBe('loading');
    expect(resolveActiveClinic(undefined, 'b').status).toBe('loading');
    expect(resolveActiveClinic([c('a'), c('b')], undefined)).toEqual({ clinic: null, status: 'loading' });
  });

  it('does not wait on the pointer when there is one clinic', () => {
    expect(resolveActiveClinic([c('a')], undefined).clinic?.id).toBe('a');
  });

  it('uses the stored pointer, and falls back without discarding a stale one', () => {
    expect(resolveActiveClinic([c('a'), c('b')], 'b').clinic?.id).toBe('b');
    expect(resolveActiveClinic([c('a')], 'gone').clinic?.id).toBe('a');
    expect(resolveActiveClinic([c('a'), c('b')], null).clinic?.id).toBe('a');
  });

  it('reports none only once the pointer read has settled', () => {
    expect(resolveActiveClinic([], undefined).status).toBe('loading');
    expect(resolveActiveClinic([], null).status).toBe('none');
  });
});

describe('useActiveClinic', () => {
  beforeEach(async () => {
    await db.clinics.clear();
    await db.meta.clear();
  });
  afterEach(cleanup);

  it('keeps the stored clinic across a reload (no clobber by clinics[0])', async () => {
    await db.clinics.bulkPut([c('a'), c('b')]);
    await db.meta.put({ key: 'activeClinicId', value: 'b' });
    const { result } = renderHook(() => useActiveClinic());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.clinic?.id).toBe('b');
    expect((await db.meta.get('activeClinicId'))?.value).toBe('b');
  });

  it('does not overwrite a stale pointer', async () => {
    await db.clinics.bulkPut([c('a')]);
    await db.meta.put({ key: 'activeClinicId', value: 'b' });
    const { result } = renderHook(() => useActiveClinic());
    await waitFor(() => expect(result.current.clinic?.id).toBe('a'));
    expect((await db.meta.get('activeClinicId'))?.value).toBe('b');
    await db.clinics.put(c('b'));
    await waitFor(() => expect(result.current.clinic?.id).toBe('b'));
  });

  it('seeds the pointer once when it has never been set', async () => {
    await db.clinics.bulkPut([c('a'), c('b')]);
    const { result } = renderHook(() => useActiveClinic());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(async () => expect((await db.meta.get('activeClinicId'))?.value).toBe('a'));
  });

  it('an explicit switch persists and is shown', async () => {
    await db.clinics.bulkPut([c('a'), c('b')]);
    await db.meta.put({ key: 'activeClinicId', value: 'a' });
    const { result } = renderHook(() => useActiveClinic());
    await waitFor(() => expect(result.current.clinic?.id).toBe('a'));
    await setActiveClinic('b');
    await waitFor(() => expect(result.current.clinic?.id).toBe('b'));
  });
});
