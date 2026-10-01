import { describe, expect, it } from 'vitest';
import { appointmentReason, countNoShows, patientFlags, type PatientFlagContext } from './patientFlags';
import type { Appointment } from './types';

const appt = (over: Partial<Appointment>): Appointment => ({
  id: 'a', clinicId: 'c', patientId: 'p1', patientName: 'Priya', patientPhone: '+91 98200 00001', therapistId: 't1',
  scheduledAt: '2026-10-01T04:30:00Z', durationMinutes: 30, status: 'confirmed', requestId: null, visitId: null,
  rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '', ...over,
});

const ctx = (over: Partial<PatientFlagContext> = {}): PatientFlagContext => ({
  patientIdsWithVisits: new Set(['p1']),
  packages: new Map(),
  balanceDue: new Set(),
  noShows: new Map(),
  conditionByPatient: new Map(),
  requestNotes: new Map(),
  ...over,
});

describe('patientFlags', () => {
  it('flags a patient with no visits, or an unlinked one, as new', () => {
    expect(patientFlags(appt({ patientId: 'p2' }), ctx()).map((f) => f.label)).toEqual(['New patient']);
    expect(patientFlags(appt({ patientId: null }), ctx()).map((f) => f.key)).toEqual(['new']);
    expect(patientFlags(appt({}), ctx())).toEqual([]);
  });

  it('shows the package session this appointment is, balance due and repeated no-shows', () => {
    const flags = patientFlags(
      appt({}),
      ctx({
        packages: new Map([['p1', { logged: 2, total: 6 }]]),
        balanceDue: new Set(['p1']),
        noShows: new Map([['p1', 3]]),
      })
    );
    expect(flags.map((f) => f.label)).toEqual(['Package 3/6', 'Balance due', '3 no-shows']);
    // Once the visit is logged, it counts as one already logged.
    expect(patientFlags(appt({ visitId: 'v' }), ctx({ packages: new Map([['p1', { logged: 3, total: 6 }]]) }))[0].label).toBe('Package 3/6');
  });

  it('is empty while the context loads', () => {
    expect(patientFlags(appt({ patientId: null }), undefined)).toEqual([]);
  });
});

describe('appointmentReason', () => {
  it('prefers the condition on file, then what the patient wrote', () => {
    const c = ctx({ conditionByPatient: new Map([['p1', 'Low back pain']]), requestNotes: new Map([['r1', 'Knee hurts']]) });
    expect(appointmentReason(appt({ requestId: 'r1' }), c)).toEqual({ text: 'Low back pain', fromPatient: false });
    expect(appointmentReason(appt({ patientId: null, requestId: 'r1' }), c)).toEqual({ text: 'Patient says: Knee hurts', fromPatient: true });
    expect(appointmentReason(appt({ patientId: null }), c)).toBeNull();
  });
});

describe('countNoShows', () => {
  it('keys unlinked patients by their last 10 phone digits', () => {
    const counts = countNoShows([
      appt({ id: '1', patientId: null, status: 'no_show' }),
      appt({ id: '2', patientId: null, patientPhone: '9820000001', status: 'no_show' }),
      appt({ id: '3', status: 'arrived' }),
    ]);
    expect(counts.get('phone:9820000001')).toBe(2);
  });
});
