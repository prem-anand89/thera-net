import { describe, expect, it } from 'vitest';
import { noteForVisit } from './noteLinks';
import type { ConsultationNote } from './types';

function note(partial: Partial<ConsultationNote> & Pick<ConsultationNote, 'id' | 'patientId' | 'status'>): ConsultationNote {
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
    const notes = [
      note({ id: 'note-1', patientId: 'pat-1', status: 'draft', visitId: 'visit-1' }),
    ];
    expect(noteForVisit(notes, 'visit-1', 'pat-1', true)?.id).toBe('note-1');
  });

  it('returns patient draft when visit needs a note but has no linked note yet', () => {
    const notes = [
      note({ id: 'note-draft', patientId: 'pat-1', status: 'draft', visitId: null }),
    ];
    const linked = noteForVisit(notes, 'visit-2', 'pat-1', true);
    expect(linked?.id).toBe('note-draft');
    expect(linked?.status).toBe('draft');
  });

  it('does not surface a patient draft when the visit is already documented', () => {
    const notes = [
      note({ id: 'note-draft', patientId: 'pat-1', status: 'draft', visitId: null }),
    ];
    expect(noteForVisit(notes, 'visit-2', 'pat-1', false)).toBeNull();
  });
});
