import { locationOf, CARE_LOCATION_LABELS } from './careLocations';
import type { CareLocation } from './types';

export interface LocationSplitVisit {
  therapistId: string;
  location?: string | null;
  actualBillPaise: number;
}

export interface LocationSplitCell {
  visits: number;
  billedPaise: number;
}

export interface LocationSplitRow {
  therapistId: string;
  places: Partial<Record<CareLocation, LocationSplitCell>>;
  total: LocationSplitCell;
}

export interface LocationSplit {
  /** Places that have at least one visit, in Clinic, Home, Inpatient order. */
  places: CareLocation[];
  rows: LocationSplitRow[];
  totals: Partial<Record<CareLocation, LocationSplitCell>> & { all: LocationSplitCell };
}

const ORDER: readonly CareLocation[] = ['clinic', 'home', 'ward'];

/**
 * Visits and billed per therapist and place. Counting only: nothing here moves money between people or changes
 * what a therapist or the clinic earns. A visit with no location (saved before locations existed) counts as Clinic.
 */
export function locationSplit(visits: readonly LocationSplitVisit[]): LocationSplit {
  const byTherapist = new Map<string, LocationSplitRow>();
  const totals: LocationSplit['totals'] = { all: { visits: 0, billedPaise: 0 } };
  const seen = new Set<CareLocation>();
  for (const v of visits) {
    const place = locationOf(v);
    seen.add(place);
    let row = byTherapist.get(v.therapistId);
    if (!row) {
      row = { therapistId: v.therapistId, places: {}, total: { visits: 0, billedPaise: 0 } };
      byTherapist.set(v.therapistId, row);
    }
    for (const cell of [
      (row.places[place] ??= { visits: 0, billedPaise: 0 }),
      row.total,
      (totals[place] ??= { visits: 0, billedPaise: 0 }),
      totals.all,
    ]) {
      cell.visits += 1;
      cell.billedPaise += v.actualBillPaise;
    }
  }
  return {
    places: ORDER.filter((l) => seen.has(l)),
    rows: [...byTherapist.values()].sort((a, b) => b.total.billedPaise - a.total.billedPaise),
    totals,
  };
}

export const locationSplitLabel = (l: CareLocation): string => CARE_LOCATION_LABELS[l];
