import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { agendaFollowUps, type AgendaFollowUpPatient } from './followUps.ts';

const patient = (over: Partial<AgendaFollowUpPatient> = {}): AgendaFollowUpPatient => ({
  id: 'p1', name: 'Kavin', phone: '9820000002', followUpOn: '2026-10-22', followUpSetOn: '2026-10-20', followUpNote: null, followUpTherapistId: 't1', ...over,
});
const dayStartMs = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const run = (patients: AgendaFollowUpPatient[], visits = [] as { patientId: string; visitDate: string }[], appointments = [] as Parameters<typeof agendaFollowUps>[0]['appointments']) =>
  agendaFollowUps({ patients, visits, appointments, forDate: '2026-10-22', dayStartMs }).map((p) => p.id);

Deno.test('lists reviews due by the agenda day, up to a week overdue, oldest first', () => {
  const ids = run([
    patient({ id: 'today' }),
    patient({ id: 'overdue', followUpOn: '2026-10-16' }),
    patient({ id: 'too-old', followUpOn: '2026-10-14' }),
    patient({ id: 'later', followUpOn: '2026-10-23' }),
  ]);
  assertEquals(ids, ['overdue', 'today']);
});

Deno.test('a later visit fulfils it; the visit that prompted it does not', () => {
  assertEquals(run([patient()], [{ patientId: 'p1', visitDate: '2026-10-20' }]), ['p1']);
  assertEquals(run([patient()], [{ patientId: 'p1', visitDate: '2026-10-21' }]), []);
  assertEquals(run([patient()], [{ patientId: 'other', visitDate: '2026-10-21' }]), ['p1']);
});

Deno.test('a confirmed appointment from the next day on fulfils it; cancelled and no-show do not', () => {
  const at = (ymd: string, status: string, patientId: string | null = 'p1', patientPhone = '') => ({ patientId, patientPhone, scheduledAtMs: Date.parse(`${ymd}T05:00:00Z`), status });
  assertEquals(run([patient()], [], [at('2026-10-24', 'confirmed')]), []);
  assertEquals(run([patient()], [], [at('2026-10-24', 'arrived')]), []);
  assertEquals(run([patient()], [], [at('2026-10-24', 'cancelled')]), ['p1']);
  assertEquals(run([patient()], [], [at('2026-10-24', 'no_show')]), ['p1']);
  assertEquals(run([patient()], [], [at('2026-10-20', 'confirmed')]), ['p1']); // the day it was set
});

Deno.test('an appointment never linked to a patient is matched by phone number', () => {
  const unlinked = { patientId: null, patientPhone: '98200 00002', scheduledAtMs: Date.parse('2026-10-24T05:00:00Z'), status: 'confirmed' };
  assertEquals(run([patient()], [], [unlinked]), []);
  assertEquals(run([patient({ phone: null })], [], [unlinked]), ['p1']);
});
