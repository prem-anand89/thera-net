import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/types';
import { THERAPIST_PALETTE, appointmentFill, colorClashes, contrastWithWhite, isReadableColor, nextUnusedColor, therapistColor } from './scheduleColors';

const appt = (over: Partial<Appointment>): Appointment =>
  ({ id: 'a', status: 'confirmed', visitId: null, ...over }) as Appointment;

describe('appointmentFill', () => {
  it('any appointment with a linked visit is done, whatever its status says', () => {
    expect(appointmentFill(appt({ status: 'confirmed', visitId: 'v1' }), '#000').kind).toBe('done');
    expect(appointmentFill(appt({ status: 'arrived', visitId: 'v1' }), '#000').kind).toBe('done');
  });
  it('keeps the other status fills', () => {
    expect(appointmentFill(appt({ status: 'arrived' }), '#000').kind).toBe('arrived');
    expect(appointmentFill(appt({ status: 'no_show' }), '#000').kind).toBe('no_show');
    expect(appointmentFill(appt({ status: 'cancelled' }), '#000').kind).toBe('cancelled');
    expect(appointmentFill(appt({ status: 'confirmed' }), '#000').kind).toBe('upcoming');
  });
});

describe('nextUnusedColor', () => {
  it('gives the first palette color nobody uses, ignoring case and missing values', () => {
    expect(nextUnusedColor([])).toBe(THERAPIST_PALETTE[0]);
    expect(nextUnusedColor([THERAPIST_PALETTE[0].toUpperCase(), null, undefined])).toBe(THERAPIST_PALETTE[1]);
    expect(nextUnusedColor(THERAPIST_PALETTE.slice(0, 7))).toBe(THERAPIST_PALETTE[7]);
  });
  it('with every color taken, picks the least repeated one', () => {
    const all = [...THERAPIST_PALETTE, ...THERAPIST_PALETTE.slice(1)];
    expect(nextUnusedColor(all)).toBe(THERAPIST_PALETTE[0]);
  });
});

describe('colorClashes', () => {
  it('finds active therapists who show in the same color, by explicit choice or default', () => {
    const blue = THERAPIST_PALETTE[0];
    const list = [
      { id: 'a', name: 'Kiran', color: blue },
      { id: 'b', name: 'BM', color: blue.toUpperCase() },
      { id: 'c', name: 'Prem', color: THERAPIST_PALETTE[1] },
      { id: 'd', name: 'Gone', color: blue, active: false },
    ];
    const clashes = colorClashes(list);
    expect(clashes).toHaveLength(1);
    expect(clashes[0].therapists.map((t) => t.name)).toEqual(['BM', 'Kiran']);
  });
  it('counts the default (ID-based) color too', () => {
    const t = { id: 'same-id', name: 'A' };
    expect(colorClashes([t, { id: 'other', name: 'B', color: therapistColor('same-id') }])).toHaveLength(1);
  });
  it('no clash when everyone differs', () => {
    expect(colorClashes([{ id: 'a', name: 'A', color: '#111111' }, { id: 'b', name: 'B', color: '#222222' }])).toEqual([]);
  });
});

describe('readable colors', () => {
  it('white is invisible, black is solid, and the palette\'s lightest swatch is accepted', () => {
    expect(contrastWithWhite('#ffffff')).toBeCloseTo(1, 1);
    expect(contrastWithWhite('#000000')).toBeCloseTo(21, 0);
    expect(isReadableColor('#ffffff')).toBe(false);
    expect(isReadableColor('#f5f5a0')).toBe(false);
    for (const color of THERAPIST_PALETTE) expect(isReadableColor(color)).toBe(true);
  });
  it('rejects text that is not a #rrggbb color', () => {
    expect(isReadableColor('blue')).toBe(false);
    expect(isReadableColor('#abc')).toBe(false);
  });
});
