import { describe, expect, it } from 'vitest';
import { locationSplit } from './careLocationSplit';

describe('locationSplit', () => {
  it('counts visits and billed per therapist and place; no location reads as Clinic', () => {
    const s = locationSplit([
      { therapistId: 'a', location: 'clinic', actualBillPaise: 100 },
      { therapistId: 'a', location: null, actualBillPaise: 50 },
      { therapistId: 'a', location: 'home', actualBillPaise: 200 },
      { therapistId: 'b', location: 'home', actualBillPaise: 300 },
    ]);
    expect(s.places).toEqual(['clinic', 'home']);
    expect(s.totals.clinic).toEqual({ visits: 2, billedPaise: 150 });
    expect(s.totals.home).toEqual({ visits: 2, billedPaise: 500 });
    expect(s.totals.all).toEqual({ visits: 4, billedPaise: 650 });
    expect(s.rows.map((r) => r.therapistId)).toEqual(['a', 'b']);
    expect(s.rows[0].places.clinic).toEqual({ visits: 2, billedPaise: 150 });
  });

  it('is empty for no visits', () => {
    const s = locationSplit([]);
    expect(s.places).toEqual([]);
    expect(s.rows).toEqual([]);
    expect(s.totals.all).toEqual({ visits: 0, billedPaise: 0 });
  });
});
