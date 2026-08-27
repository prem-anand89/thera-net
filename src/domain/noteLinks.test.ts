import { describe, expect, it } from 'vitest';
import { noteForVisit, sessionNotesAllowedByPatient } from './noteLinks';
import type { ConsultationNote, PatientModuleEnrollment } from './types';

function enrollment(
  partial: Partial<PatientModuleEnrollment> &
    Pick<PatientModuleEnrollment, 'id' | 'patientId' | 'status'>
): PatientModuleEnrollment {
  return {
    clinicId: 'clinic-1',
    moduleType: 'consultation_notes',
    enrolledAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function note(
  partial: Partial<ConsultationNote> & Pick<ConsultationNote, 'id' | 'patientId' | 'status'>
): ConsultationNote {
  return {
    clinicId: 'clinic-1',
    therapistId: 'ther-1',
    visitId: null,
    enrollmentId: 'enroll-1',
    authorizedSessionCount: null,
    notesText: null,
    assessmentPayload: null,
    noteMode: 'initial',
    nrsScore: null,
    psfsMean: null,
    redFlagCount: 0,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('noteForVisit', () => {
  it('returns the visit-linked note when present', () => {
    const notes = [note({ id: 'note-1', patientId: 'pat-1', status: 'draft', visitId: 'visit-1' })];
    expect(noteForVisit(notes, 'visit-1', 'pat-1', true)?.id).toBe('note-1');
  });

  it('returns patient draft when visit needs a note but has no linked note yet', () => {
    const notes = [note({ id: 'note-draft', patientId: 'pat-1', status: 'draft', visitId: null })];
    const linked = noteForVisit(notes, 'visit-2', 'pat-1', true);
    expect(linked?.id).toBe('note-draft');
    expect(linked?.status).toBe('draft');
  });

  it('does not surface a patient draft when the visit is already documented', () => {
    const notes = [note({ id: 'note-draft', patientId: 'pat-1', status: 'draft', visitId: null })];
    expect(noteForVisit(notes, 'visit-2', 'pat-1', false)).toBeNull();
  });

  it('returns a visit-linked session note directly, same as any other mode', () => {
    const notes = [
      note({
        id: 'session-1',
        patientId: 'pat-1',
        status: 'draft',
        visitId: 'visit-1',
        noteMode: 'session',
      }),
    ];
    expect(noteForVisit(notes, 'visit-1', 'pat-1', true)?.id).toBe('session-1');
  });

  it('an open session draft on one visit does not leak into another visit needing a note', () => {
    const notes = [
      note({
        id: 'session-1',
        patientId: 'pat-1',
        status: 'draft',
        visitId: 'visit-1',
        noteMode: 'session',
      }),
    ];
    expect(noteForVisit(notes, 'visit-2', 'pat-1', true)).toBeNull();
  });

  it('the patientDraft fallback ignores a session draft even with no visitId', () => {
    const notes = [
      note({
        id: 'session-1',
        patientId: 'pat-1',
        status: 'draft',
        visitId: null,
        noteMode: 'session',
      }),
    ];
    expect(noteForVisit(notes, 'visit-2', 'pat-1', true)).toBeNull();
  });

  it('the patientDraft fallback still surfaces a legacy null-noteMode heavy draft', () => {
    const notes = [
      note({
        id: 'legacy-draft',
        patientId: 'pat-1',
        status: 'draft',
        visitId: null,
        noteMode: null,
      }),
    ];
    expect(noteForVisit(notes, 'visit-2', 'pat-1', true)?.id).toBe('legacy-draft');
  });
});

describe('sessionNotesAllowedByPatient', () => {
  it('false for a patient with an active enrollment but no completed heavy note', () => {
    const enrollments = [enrollment({ id: 'enr-1', patientId: 'pat-1', status: 'active' })];
    const map = sessionNotesAllowedByPatient([], enrollments);
    expect(map.get('pat-1')).toBe(false);
  });

  it('true once a completed heavy note exists in the active enrollment', () => {
    const enrollments = [enrollment({ id: 'enr-1', patientId: 'pat-1', status: 'active' })];
    const notes = [
      note({
        id: 'note-1',
        patientId: 'pat-1',
        status: 'completed',
        enrollmentId: 'enr-1',
        noteMode: 'initial',
      }),
    ];
    const map = sessionNotesAllowedByPatient(notes, enrollments);
    expect(map.get('pat-1')).toBe(true);
  });

  it('a draft heavy note does not unlock session notes', () => {
    const enrollments = [enrollment({ id: 'enr-1', patientId: 'pat-1', status: 'active' })];
    const notes = [
      note({
        id: 'note-1',
        patientId: 'pat-1',
        status: 'draft',
        enrollmentId: 'enr-1',
        noteMode: 'initial',
      }),
    ];
    const map = sessionNotesAllowedByPatient(notes, enrollments);
    expect(map.get('pat-1')).toBe(false);
  });

  it('a completed heavy note in a different (inactive/past) enrollment does not count', () => {
    const enrollments = [enrollment({ id: 'enr-2', patientId: 'pat-1', status: 'active' })];
    const notes = [
      note({
        id: 'note-1',
        patientId: 'pat-1',
        status: 'completed',
        enrollmentId: 'enr-1',
        noteMode: 'initial',
      }),
    ];
    const map = sessionNotesAllowedByPatient(notes, enrollments);
    expect(map.get('pat-1')).toBe(false);
  });

  it('a completed session note does not count as the heavy gate', () => {
    const enrollments = [enrollment({ id: 'enr-1', patientId: 'pat-1', status: 'active' })];
    const notes = [
      note({
        id: 'note-1',
        patientId: 'pat-1',
        status: 'completed',
        enrollmentId: 'enr-1',
        noteMode: 'session',
      }),
    ];
    const map = sessionNotesAllowedByPatient(notes, enrollments);
    expect(map.get('pat-1')).toBe(false);
  });

  it('a patient with no active enrollment has no map entry', () => {
    const enrollments = [enrollment({ id: 'enr-1', patientId: 'pat-1', status: 'discharged' })];
    const map = sessionNotesAllowedByPatient([], enrollments);
    expect(map.has('pat-1')).toBe(false);
  });
});
