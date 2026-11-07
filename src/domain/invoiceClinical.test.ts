import { describe, expect, it } from 'vitest';
import { pickReferralNote, placeOfServiceFor, placeOfServiceLabel, treatmentsFor } from './invoiceClinical';
import type { ConsultationNote } from './types';

describe('placeOfServiceFor', () => {
  it('is the one place when every visit was there', () => {
    expect(placeOfServiceFor([{ location: 'clinic' }, { location: 'clinic' }])).toEqual({ place: 'clinic', locations: ['clinic'] });
    expect(placeOfServiceFor([{ location: 'home' }])).toEqual({ place: 'home', locations: ['home'] });
  });
  it('is mixed, with the places in a fixed order, when visits were in more than one', () => {
    expect(placeOfServiceFor([{ location: 'home' }, { location: 'clinic' }, { location: 'home' }])).toEqual({
      place: 'mixed',
      locations: ['clinic', 'home'],
    });
  });
  it('a visit with no location counts as clinic, and no visits is clinic', () => {
    expect(placeOfServiceFor([{}, { location: undefined }]).place).toBe('clinic');
    expect(placeOfServiceFor([]).place).toBe('clinic');
    expect(placeOfServiceFor([{}, { location: 'home' }]).place).toBe('mixed');
  });
});

describe('treatmentsFor', () => {
  const catalog = [
    { id: 't1', name: 'Manual therapy' },
    { id: 't2', name: 'Dry needling' },
    { id: 't3', name: 'Taping' },
  ];
  const v = (visitDate: string, treatmentIds: string[], treatmentNotes: string | null = null) => ({ visitDate, treatmentIds, treatmentNotes });

  it('lists each treatment once, in the order first done', () => {
    expect(treatmentsFor([v('2026-11-04', ['t2']), v('2026-11-02', ['t1', 't2']), v('2026-11-06', ['t3', 't1'])], catalog)).toBe(
      'Manual therapy, Dry needling, Taping'
    );
  });
  it('adds each visit\'s own words once, after the treatments', () => {
    expect(treatmentsFor([v('2026-11-02', ['t1'], ' knee brace fitted '), v('2026-11-03', [], 'knee brace fitted'), v('2026-11-04', [], 'gait drills')], catalog)).toBe(
      'Manual therapy — knee brace fitted, gait drills'
    );
  });
  it('is empty when nothing was recorded, and ignores a treatment no longer in the catalog', () => {
    expect(treatmentsFor([v('2026-11-02', [])], catalog)).toBe('');
    expect(treatmentsFor([v('2026-11-02', ['gone', 't1'])], catalog)).toBe('Manual therapy');
  });
  it('is cut at 200 characters with an ellipsis', () => {
    const long = 'x'.repeat(260);
    const out = treatmentsFor([v('2026-11-02', [], long)], catalog);
    expect(out.length).toBe(200);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('pickReferralNote', () => {
  const note = (id: string, over: Partial<ConsultationNote>): ConsultationNote =>
    ({ id, visitId: null, status: 'completed', noteMode: 'initial', updatedAt: '2026-11-01T00:00:00Z', assessmentPayload: { referral: { diagnosis: id } }, ...over }) as ConsultationNote;
  const visits = [
    { id: 'v1', visitDate: '2026-11-02' },
    { id: 'v2', visitDate: '2026-11-10' },
  ];

  it('prefers a note linked to one of the visits, the latest visit first', () => {
    const notes = [note('linked1', { visitId: 'v1' }), note('linked2', { visitId: 'v2' }), note('other', { updatedAt: '2026-11-09T00:00:00Z' })];
    expect(pickReferralNote(notes, visits)?.id).toBe('linked2');
  });
  it('else the latest completed heavy note updated on or before the last visit', () => {
    const notes = [
      note('old', { updatedAt: '2026-10-01T00:00:00Z' }),
      note('inperiod', { updatedAt: '2026-11-08T00:00:00Z' }),
      note('afterwards', { updatedAt: '2026-12-01T00:00:00Z' }),
    ];
    expect(pickReferralNote(notes, visits)?.id).toBe('inperiod');
  });
  it('else the latest completed note overall', () => {
    const notes = [note('a', { updatedAt: '2026-12-01T00:00:00Z' }), note('b', { updatedAt: '2026-12-05T00:00:00Z' })];
    expect(pickReferralNote(notes, visits)?.id).toBe('b');
  });
  it('never returns a session note, a draft, or a note without a referral', () => {
    const notes = [
      note('session', { noteMode: 'session' }),
      note('draft', { status: 'draft' }),
      note('nref', { assessmentPayload: { chiefComplaint: {} } }),
    ];
    expect(pickReferralNote(notes, visits)).toBeUndefined();
  });
  it('a linked note without a referral does not block the fallbacks', () => {
    const notes = [note('linked', { visitId: 'v1', assessmentPayload: { chiefComplaint: {} } }), note('fallback', { updatedAt: '2026-11-05T00:00:00Z' })];
    expect(pickReferralNote(notes, visits)?.id).toBe('fallback');
  });
});

describe('placeOfServiceLabel', () => {
  it('names each place, and the mix', () => {
    expect(placeOfServiceLabel({ placeOfService: 'clinic' })).toBe('Clinic');
    expect(placeOfServiceLabel({ placeOfService: 'home' })).toBe('Home (domiciliary)');
    expect(placeOfServiceLabel({ placeOfService: 'ward' })).toBe('Ward');
    expect(placeOfServiceLabel({ placeOfService: 'mixed', locations: ['clinic', 'home'] })).toBe('Clinic and Home');
    expect(placeOfServiceLabel({ placeOfService: 'mixed', locations: ['clinic', 'home', 'ward'] })).toBe('Clinic and Home and Ward');
  });
  it('an old invoice or none prints as before', () => {
    expect(placeOfServiceLabel(null)).toBeNull();
    expect(placeOfServiceLabel({ placeOfService: null })).toBeNull();
    expect(placeOfServiceLabel({ placeOfService: 'mixed' })).toBe('Clinic and Home');
  });
});
