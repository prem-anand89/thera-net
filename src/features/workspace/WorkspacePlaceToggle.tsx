import { segTrack, segOption } from '@/components/ui';
import { bookableLocations, CARE_LOCATION_LABELS } from '@/domain/careLocations';
import type { CareLocation } from '@/domain/types';

/** The Workspace's place choice: '' is every place. */
export type WorkspacePlace = '' | CareLocation;

/** True when a record belongs in the chosen place ('' keeps everything). A record with no place reads as Clinic. */
export function inWorkspacePlace(place: WorkspacePlace, record: { location?: string | null }): boolean {
  return !place || (record.location ?? 'clinic') === place;
}

/**
 * "Place: All | Clinic | Home visit", beside All | Mine. It governs the appointments and today's visits below it
 * (not Follow up: reviews belong to a patient and a package can mix places). Shown only when the clinic sees
 * patients in more than one place.
 */
export function WorkspacePlaceToggle({
  clinic,
  value,
  onChange,
}: {
  clinic: { careLocations?: readonly string[] | null };
  value: WorkspacePlace;
  onChange: (next: WorkspacePlace) => void;
}) {
  const places = bookableLocations(clinic);
  if (places.length < 2) return null;
  const options: [WorkspacePlace, string][] = [['', 'All'], ...places.map((l): [WorkspacePlace, string] => [l, CARE_LOCATION_LABELS[l]])];
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--muted)]">Place</span>
      <div role="group" aria-label="Place" className={segTrack}>
        {options.map(([key, label]) => (
          <button
            key={key || 'all'}
            type="button"
            aria-pressed={value === key}
            onClick={() => onChange(key)}
            className={segOption(value === key)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
