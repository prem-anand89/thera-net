import { describe, expect, it } from 'vitest';
import { bookableLocations, CARE_LOCATION_LABELS, defaultBookingLocation, clinicCareLocations, homeCareOn, locationOf, offersLocationChoice } from './careLocations';

describe('clinicCareLocations', () => {
  it('reads as clinic only until a clinic turns something on, including older rows and bad values', () => {
    for (const c of [undefined, null, {}, { careLocations: null }, { careLocations: [] }, { careLocations: ['nope'] }]) {
      expect(clinicCareLocations(c)).toEqual(['clinic']);
      expect(offersLocationChoice(c)).toBe(false);
      expect(homeCareOn(c)).toBe(false);
    }
  });

  it('keeps a fixed order whatever order is stored, and drops unknown values', () => {
    expect(clinicCareLocations({ careLocations: ['ward', 'nope', 'clinic', 'home'] })).toEqual(['clinic', 'home', 'ward']);
  });

  it('a home-only clinic has one location, so no choice is offered, but home care is on', () => {
    const c = { careLocations: ['home'] };
    expect(clinicCareLocations(c)).toEqual(['home']);
    expect(offersLocationChoice(c)).toBe(false);
    expect(homeCareOn(c)).toBe(true);
  });

  it('two locations offer a choice', () => {
    expect(offersLocationChoice({ careLocations: ['clinic', 'home'] })).toBe(true);
  });
});

describe('locationOf', () => {
  it('reads a visit with no location (196 live rows) or an unknown one as clinic', () => {
    expect(locationOf({ location: null })).toBe('clinic');
    expect(locationOf({})).toBe('clinic');
    expect(locationOf(undefined)).toBe('clinic');
    expect(locationOf({ location: 'moon' })).toBe('clinic');
    expect(locationOf({ location: 'home' })).toBe('home');
    expect(locationOf({ location: 'ward' })).toBe('ward');
  });
});

describe('labels', () => {
  it('uses the agreed screen words', () => {
    expect(CARE_LOCATION_LABELS).toEqual({ clinic: 'Clinic', home: 'Home visit', ward: 'Inpatient' });
  });
});

describe('booking location', () => {
  it('a clinic-only clinic books at the clinic whatever the service says', () => {
    expect(defaultBookingLocation({ careLocations: ['clinic'] }, { defaultLocation: 'home' })).toBe('clinic');
    expect(defaultBookingLocation({})).toBe('clinic');
  });
  it('a clinic that offers both starts from the service, else Clinic', () => {
    const c = { careLocations: ['clinic', 'home'] };
    expect(defaultBookingLocation(c, { defaultLocation: 'home' })).toBe('home');
    expect(defaultBookingLocation(c, { defaultLocation: 'clinic' })).toBe('clinic');
    expect(defaultBookingLocation(c, null)).toBe('clinic');
  });
  it('a home-only clinic starts on Home with no choice to make', () => {
    expect(defaultBookingLocation({ careLocations: ['home'] }, { defaultLocation: 'clinic' })).toBe('home');
    expect(bookableLocations({ careLocations: ['home'] })).toEqual(['home']);
  });
  it('inpatient is not bookable yet', () => {
    expect(bookableLocations({ careLocations: ['clinic', 'ward'] })).toEqual(['clinic']);
  });
});
