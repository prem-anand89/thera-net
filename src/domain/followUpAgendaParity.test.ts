import { describe, expect, it } from 'vitest';
import { followUpFulfilled } from './followUp';
import { agendaFollowUps } from '../../supabase/functions/_shared/followUps';
import { localDateTime } from './schedule';
import type { Appointment, Patient, Visit } from './types';

/**
 * The agenda email decides "not fulfilled" in the edge function (Deno, no access to src/), the app in
 * domain/followUp.ts. They must never disagree, or the email would nag about someone the app shows as done.
 */
const SET_ON = '2026-10-20';
const FOR_DATE = '2026-10-22';
const patient: Patient = {
  id: 'p1', clinicId: 'c', mrno: '1', mrnoSource: 'hospital', name: 'Kavin', age: null, sex: null, phone: '98200 00002',
  primaryCondition: null, followUpOn: FOR_DATE, followUpSetOn: SET_ON, followUpTherapistId: 't1', followUpNote: null, updatedAt: '',
};
const at = (date: string, time = '10:00') => localDateTime(date, time).toISOString();

const visit = (visitDate: string, over: Partial<Visit> = {}) => ({ id: 'v', clinicId: 'c', patientId: 'p1', visitDate, deleted: false, ...over }) as Visit;
const appt = (scheduledAt: string, status: Appointment['status'], over: Partial<Appointment> = {}): Appointment => ({
  id: 'a', clinicId: 'c', patientId: 'p1', patientName: 'Kavin', patientPhone: '9820000002', therapistId: 't1', scheduledAt, status,
  requestId: null, visitId: null, rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '', ...over,
});

const scenarios: { name: string; visits: Visit[]; appointments: Appointment[] }[] = [
  { name: 'nothing since', visits: [], appointments: [] },
  { name: 'visit the day it was set', visits: [visit(SET_ON)], appointments: [] },
  { name: 'visit the next day', visits: [visit('2026-10-21')], appointments: [] },
  { name: 'deleted later visit', visits: [visit('2026-10-21', { deleted: true })], appointments: [] },
  { name: 'confirmed appointment later', visits: [], appointments: [appt(at('2026-10-24'), 'confirmed')] },
  { name: 'arrived appointment later', visits: [], appointments: [appt(at('2026-10-24'), 'arrived')] },
  { name: 'cancelled appointment later', visits: [], appointments: [appt(at('2026-10-24'), 'cancelled')] },
  { name: 'no-show later', visits: [], appointments: [appt(at('2026-10-24'), 'no_show')] },
  { name: 'appointment the day it was set', visits: [], appointments: [appt(at(SET_ON, '16:00'), 'confirmed')] },
  { name: 'appointment the next morning', visits: [], appointments: [appt(at('2026-10-21', '00:30'), 'confirmed')] },
  { name: 'unlinked appointment, same phone', visits: [], appointments: [appt(at('2026-10-24'), 'confirmed', { patientId: null })] },
  { name: 'unlinked appointment, other phone', visits: [], appointments: [appt(at('2026-10-24'), 'confirmed', { patientId: null, patientPhone: '9000000000' })] },
];

describe('agenda follow-ups agree with the app on "fulfilled"', () => {
  for (const scenario of scenarios) {
    it(scenario.name, () => {
      const inEmail =
        agendaFollowUps({
          patients: [{ id: 'p1', name: 'Kavin', phone: patient.phone, followUpOn: FOR_DATE, followUpSetOn: SET_ON, followUpNote: null, followUpTherapistId: 't1' }],
          visits: scenario.visits.filter((v) => !v.deleted).map((v) => ({ patientId: v.patientId, visitDate: v.visitDate })),
          appointments: scenario.appointments.map((a) => ({
            patientId: a.patientId,
            patientPhone: a.patientPhone,
            scheduledAtMs: new Date(a.scheduledAt).getTime(),
            status: a.status,
          })),
          forDate: FOR_DATE,
          dayStartMs: (ymd) => localDateTime(ymd, '00:00').getTime(),
        }).length === 1;
      expect(inEmail).toBe(!followUpFulfilled(patient, scenario.visits, scenario.appointments));
    });
  }
});
