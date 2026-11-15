// Turns a program's (or one exercise's) items into what the patient page receives, so the therapist's preview can
// render the real patient screens. Nothing here is saved.
import type { SessionsPerDay } from '@/domain/hep';
import type { PublicHepItem } from '@/services/publicHepService';
import type { HepItemInput } from '@/services/hepService';
import { orderBySection } from './hepItems';

export function toPreviewItems(
  items: HepItemInput[],
  opts: { today: string; sessionsPerDay: SessionsPerDay; mediaUrls: Record<string, string> },
): PublicHepItem[] {
  return orderBySection(items).map((it, index) => {
    const keys = it.mediaKeys.map((k, i) => ({ url: opts.mediaUrls[k], caption: it.mediaCaptions[i] ?? '' })).filter((m) => !!m.url);
    return {
      id: `preview-${index}`,
      title: it.title,
      phase: it.phase,
      equipment: [...it.equipment],
      instructions: it.instructions,
      mediaType: keys.length === 0 ? 'none' : it.mediaType,
      mediaUrls: keys.map((m) => m.url),
      mediaCaptions: keys.map((m) => m.caption),
      doseType: it.doseType,
      sets: it.sets,
      reps: it.reps,
      holdSeconds: it.holdSeconds,
      durationSeconds: it.durationSeconds,
      restSeconds: it.restSeconds,
      sessionsPerDay: opts.sessionsPerDay,
      sessionsSchedule: [{ from: opts.today, sessionsPerDay: opts.sessionsPerDay }],
      side: it.side,
      optional: it.optional,
      stopIf: it.stopIf,
      specialInstructions: it.specialInstructions ?? '',
      sortOrder: index,
      addedOn: opts.today,
      // The preview shows pictures in the checklist until the item carries its exercise's "Hide pictures in lists".
      hidePicturesInLists: false,
    };
  });
}
