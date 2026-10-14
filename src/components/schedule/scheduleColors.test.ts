import { describe, expect, it } from 'vitest';
import type { Appointment } from '@/domain/types';
import { appointmentFill } from './scheduleColors';

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
