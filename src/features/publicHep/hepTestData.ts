// Shared fixtures for the patient page's tests.
import type { PublicHepItem } from '@/services/publicHepService';
import type { HepData } from './HepExercises';
import type { PublicLog } from './hepSession';

export const TODAY = '2026-11-14';

export function item(over: Partial<PublicHepItem> = {}): PublicHepItem {
  return {
    id: 'i1', title: 'Wall Slides', phase: 'strengthening', equipment: [], instructions: 'Stand with your back to a wall.\nSlide down slowly.',
    mediaType: 'none', mediaUrls: [], mediaCaptions: [], doseType: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null, restSeconds: 0,
    sessionsPerDay: 1, sessionsSchedule: [], side: 'none', optional: false, stopIf: '', specialInstructions: '', sortOrder: 0, addedOn: '2026-11-01', ...over,
  };
}

export const log = (itemId: string, session: 1 | 2 | 3 = 1, over: Partial<PublicLog> = {}): PublicLog => ({
  programItemId: itemId, logDate: TODAY, sessionIndex: session, skipped: false, skipReason: null, completedAt: '2026-11-14T04:00:00Z', ...over,
});

export function hepData(items: PublicHepItem[], over: Partial<HepData> = {}): HepData {
  return {
    clinicId: 'c1',
    today: TODAY,
    clinic: { name: 'Sunrise Physiotherapy', logoPath: null, phone: '+91 98765 43210', timezone: 'Asia/Kolkata' },
    programs: [{ id: 'p1', title: 'Knee program', startDate: '2026-11-10', durationDays: 14, feedbackDefault: 'pain', prescribedBy: 'Meera' }],
    shownProgramId: 'p1',
    items,
    logs: [],
    sessionFeedback: [],
    ...over,
  };
}
