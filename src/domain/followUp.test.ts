import { describe, expect, it } from 'vitest';
import { followUpDateFor, followUpFulfilled, followUpLists, followUpState, noShowsToRebook } from './followUp';
import { localDateTime } from './schedule';
import type { Appointment, Patient, Visit } from './types';

const at = (date: string, time = '10:00') => localDateTime(date, time).toISOString();

function patient(over: Partial<Patient> = {}): Patient {
  return {
    id: 'p1', clinicId: 'c', mrno: '1', mrnoSource: 'hospital', name: 'Kavin', age: null, sex: null, phone: '98200 00002',
    primaryCondition: null, followUpOn: '2026-10-30', followUpSetOn: '2026-10-28', followUpTherapistId: 't1', updatedAt: '', ...over,
  };
}
function visit(over: Partial<Visit> = {}): Visit {
  return { id: 'v1', clinicId: 'c', patientId: 'p1', therapistId: 't1', visitDate: '2026-10-28', deleted: false, ...over } as Visit;
}
function appt(over: Partial<Appointment> = {}): Appointment {
  return {
    id: 'a1', clinicId: 'c', patientId: 'p1', patientName: 'Kavin', patientPhone: '9820000002', therapistId: 't1',
    scheduledAt: at('2026-10-30'), status: 'confirmed', requestId: null, visitId: null, rescheduleCount: 0,
    previousScheduledAt: null, createdAt: '', updatedAt: '', ...over,
  };
}

describe('followUpDateFor', () => {
  it('counts presets from the day it is set', () => {
    expect(followUpDateFor('2d', '2026-10-28')).toBe('2026-10-30');
    expect(followUpDateFor('3d', '2026-10-30')).toBe('2026-11-02');
    expect(followUpDateFor('1w', '2026-10-28')).toBe('2026-11-04');
  });
});

describe('followUpState', () => {
  const state = (today: string, over: Partial<Patient> = {}, visits: Visit[] = [], appts: Appointment[] = []) =>
    followUpState(patient(over), visits, appts, today).state;

  it('walks planned -> due soon -> due -> overdue -> missed -> expired as the date passes', () => {
    expect(state('2026-10-20')).toBe('planned');
    expect(state('2026-10-27')).toBe('due_soon');
    expect(state('2026-10-30')).toBe('due');
    expect(state('2026-11-06')).toBe('overdue'); // 7 days past: still reminded
    expect(state('2026-11-07')).toBe('missed'); // 8 days past
    expect(state('2026-11-29')).toBe('missed'); // 30 days past
    expect(state('2026-11-30')).toBe('expired');
  });

  it('is none without a date', () => {
    expect(state('2026-10-30', { followUpOn: null })).toBe('none');
  });

  it('is done once the patient has a visit after the day it was set', () => {
    expect(state('2026-10-31', {}, [visit({ visitDate: '2026-10-31' })])).toBe('done');
  });
});

describe('followUpFulfilled', () => {
  it('ignores the visit that prompted it and any other visit the same day', () => {
    expect(followUpFulfilled(patient(), [visit({ visitDate: '2026-10-28' }), visit({ id: 'v2', visitDate: '2026-10-28' })], [])).toBe(false);
  });

  it('ignores deleted visits and other patients', () => {
    expect(followUpFulfilled(patient(), [visit({ visitDate: '2026-10-31', deleted: true }), visit({ id: 'v3', patientId: 'p2', visitDate: '2026-10-31' })], [])).toBe(false);
  });

  it('counts a confirmed, rescheduled or arrived appointment after the set day', () => {
    for (const status of ['confirmed', 'rescheduled', 'arrived'] as const) {
      expect(followUpFulfilled(patient(), [], [appt({ status })])).toBe(true);
    }
  });

  it('does not count a cancelled or no-show appointment, so the follow-up comes back', () => {
    expect(followUpFulfilled(patient(), [], [appt({ status: 'cancelled' })])).toBe(false);
    expect(followUpFulfilled(patient(), [], [appt({ status: 'no_show' })])).toBe(false);
  });

  it('does not count an appointment on the day it was set', () => {
    expect(followUpFulfilled(patient(), [], [appt({ scheduledAt: at('2026-10-28', '16:00') })])).toBe(false);
  });

  it('matches an unlinked appointment by phone number', () => {
    expect(followUpFulfilled(patient(), [], [appt({ patientId: null, patientPhone: '+91 98200 00002' })])).toBe(false); // country code differs
    expect(followUpFulfilled(patient(), [], [appt({ patientId: null, patientPhone: '9820000002' })])).toBe(true);
  });
});

describe('followUpLists', () => {
  const today = '2026-10-30';
  const patients = [
    patient({ id: 'soon', followUpOn: '2026-11-01' }),
    patient({ id: 'overdue', followUpOn: '2026-10-27' }),
    patient({ id: 'missed', followUpOn: '2026-10-15' }),
    patient({ id: 'far', followUpOn: '2026-12-01' }),
    patient({ id: 'gone', followUpOn: '2026-10-30', deletedAt: '2026-10-01' }),
    patient({ id: 'other', followUpOn: '2026-10-30', followUpTherapistId: 't2' }),
    patient({ id: 'none', followUpOn: null }),
  ];

  it('splits what is being acted on from what was missed, soonest and most recent first', () => {
    const lists = followUpLists(patients, [], [], today);
    expect(lists.due.map((r) => r.patient.id)).toEqual(['overdue', 'other', 'soon']);
    expect(lists.missed.map((r) => r.patient.id)).toEqual(['missed']);
  });

  it("limits a therapist to their own", () => {
    const lists = followUpLists(patients, [], [], today, { therapistId: 't2' });
    expect(lists.due.map((r) => r.patient.id)).toEqual(['other']);
    expect(lists.missed).toEqual([]);
  });

  it('drops a fulfilled one', () => {
    const lists = followUpLists(patients, [visit({ patientId: 'overdue', visitDate: '2026-10-29' })], [], today);
    expect(lists.due.map((r) => r.patient.id)).not.toContain('overdue');
  });
});

describe('noShowsToRebook', () => {
  const today = '2026-10-30';
  const p = patient({ followUpOn: null });

  it('lists a recent no-show with nothing booked since', () => {
    const rows = noShowsToRebook([appt({ status: 'no_show', scheduledAt: at('2026-10-27') })], [], [p], today);
    expect(rows).toHaveLength(1);
    expect(rows[0].patient?.id).toBe('p1');
  });

  it('skips old ones, and ones already rebooked or visited since', () => {
    expect(noShowsToRebook([appt({ status: 'no_show', scheduledAt: at('2026-10-01') })], [], [p], today)).toEqual([]);
    const rebooked = [appt({ id: 'ns', status: 'no_show', scheduledAt: at('2026-10-27') }), appt({ id: 'new', scheduledAt: at('2026-11-02') })];
    expect(noShowsToRebook(rebooked, [], [p], today)).toEqual([]);
    expect(noShowsToRebook([appt({ status: 'no_show', scheduledAt: at('2026-10-27') })], [visit({ visitDate: '2026-10-29' })], [p], today)).toEqual([]);
  });

  it('a cancelled later appointment does not count as rebooked, and one patient appears once', () => {
    const list = [
      appt({ id: 'ns1', status: 'no_show', scheduledAt: at('2026-10-27') }),
      appt({ id: 'ns2', status: 'no_show', scheduledAt: at('2026-10-25') }),
      appt({ id: 'cx', status: 'cancelled', scheduledAt: at('2026-11-02') }),
    ];
    expect(noShowsToRebook(list, [], [p], today)).toHaveLength(1);
  });

  it("limits a therapist to their own patients' no-shows", () => {
    const rows = noShowsToRebook([appt({ status: 'no_show', scheduledAt: at('2026-10-27'), therapistId: 't2' })], [], [p], today, { therapistId: 't1' });
    expect(rows).toEqual([]);
  });
});
