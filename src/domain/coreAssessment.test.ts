import { describe, expect, it } from 'vitest';
import {
  computeBmi,
  computeDerivedFields,
  computeWaistToHeightRatio,
  emptyPayload,
  outcomeTrend,
  sectionCompletion,
  frequencyLabel,
  orderedOutcomeInstruments,
  outcomeInstrumentDef,
  OUTCOME_INSTRUMENTS,
} from './coreAssessment';

// One test per registered instrument, per the handoff's own instruction:
// "Getting this wrong renders a deteriorating patient as improving, so it
// is worth a unit test per registered instrument."
describe('outcomeTrend', () => {
  describe('PSFS — higher-is-better', () => {
    it('is improving when the score increases', () => {
      expect(outcomeTrend('higher-is-better', 4, 7)).toBe('improving');
    });
    it('is declining when the score decreases', () => {
      expect(outcomeTrend('higher-is-better', 7, 4)).toBe('declining');
    });
    it('is stable when unchanged', () => {
      expect(outcomeTrend('higher-is-better', 5, 5)).toBe('stable');
    });
  });

  describe('NRS — lower-is-better', () => {
    it('is improving when the score decreases', () => {
      expect(outcomeTrend('lower-is-better', 7, 3)).toBe('improving');
    });
    it('is declining when the score increases', () => {
      expect(outcomeTrend('lower-is-better', 3, 7)).toBe('declining');
    });
    it('is stable when unchanged', () => {
      expect(outcomeTrend('lower-is-better', 4, 4)).toBe('stable');
    });
  });
});

describe('computeBmi', () => {
  it('computes weight(kg) / height(m)^2, rounded to 1 decimal', () => {
    expect(computeBmi(70, 175)).toBe(22.9);
  });
  it('is null when weight is missing', () => {
    expect(computeBmi(undefined, 175)).toBeNull();
  });
  it('is null when height is missing', () => {
    expect(computeBmi(70, undefined)).toBeNull();
  });
});

describe('computeWaistToHeightRatio', () => {
  it('computes waist(cm) / height(cm), rounded to 2 decimals', () => {
    expect(computeWaistToHeightRatio(80, 175)).toBe(0.46);
  });
  it('is null when waist is missing', () => {
    expect(computeWaistToHeightRatio(undefined, 175)).toBeNull();
  });
  it('is null when height is missing', () => {
    expect(computeWaistToHeightRatio(80, undefined)).toBeNull();
  });
});

describe('computeDerivedFields', () => {
  it('reads nrsScore from painProfile.nrs.current, not Best or Worst', () => {
    const payload = { ...emptyPayload(), painProfile: { ...emptyPayload().painProfile, nrs: { current: 4, best: 1, worst: 9 } } };
    expect(computeDerivedFields(payload).nrsScore).toBe(4);
  });
});

describe('sectionCompletion', () => {
  it('reads Chief Complaint as required-empty when anatomicalRegion is blank, even with other fields filled', () => {
    const payload = {
      ...emptyPayload(),
      chiefComplaint: { ...emptyPayload().chiefComplaint, presentingProblem: 'Low back pain', onset: 'gradual-overuse' as const },
    };
    expect(sectionCompletion('chiefComplaint', payload)).toBe('required-empty');
  });

  it('reads Chief Complaint as complete once the region and every optional field are filled', () => {
    const payload = {
      ...emptyPayload(),
      chiefComplaint: {
        ...emptyPayload().chiefComplaint,
        anatomicalRegion: 'Lumbar Spine' as const,
        presentingProblem: 'Low back pain',
        primaryComplaint: ['Pain'],
        onset: 'gradual-overuse' as const,
      },
    };
    expect(sectionCompletion('chiefComplaint', payload)).toBe('complete');
  });

  it('reads Chief Complaint as empty with only the required region set, partial once one optional field joins it', () => {
    const regionOnly = {
      ...emptyPayload(),
      chiefComplaint: { ...emptyPayload().chiefComplaint, anatomicalRegion: 'Lumbar Spine' as const },
    };
    expect(sectionCompletion('chiefComplaint', regionOnly)).toBe('empty');

    const regionPlusOnset = {
      ...emptyPayload(),
      chiefComplaint: { ...emptyPayload().chiefComplaint, anatomicalRegion: 'Lumbar Spine' as const, onset: 'gradual-overuse' as const },
    };
    expect(sectionCompletion('chiefComplaint', regionPlusOnset)).toBe('partial');
  });

  it('reads a freshly emptied payload as empty across every optional section, never required-empty', () => {
    const payload = emptyPayload();
    const optionalSections = ['history', 'subjective', 'psfs', 'objective', 'treatment', 'hep', 'plan', 'outcome'] as const;
    for (const key of optionalSections) {
      expect(sectionCompletion(key, payload)).toBe('empty');
    }
  });

  it('does not count a default boolean/enum value (priorSurgery, pregnancyStatus) as progress', () => {
    // priorSurgery defaults to false and pregnancyStatus to 'not-applicable' in
    // emptyPayload() — neither should make Chief Complaint or History read as
    // touched on their own.
    const payload = emptyPayload();
    expect(payload.chiefComplaint.priorSurgery).toBe(false);
    expect(sectionCompletion('chiefComplaint', payload)).toBe('required-empty');
    expect(sectionCompletion('history', payload)).toBe('empty');
  });

  it('reads History as partial once medications is filled, complete once every tracked field is', () => {
    const base = emptyPayload();
    const partial = { ...base, history: { ...base.history, medications: 'Metformin' } };
    expect(sectionCompletion('history', partial)).toBe('partial');

    const complete = {
      ...base,
      history: {
        ...base.history,
        medicalConditions: ['Diabetes'],
        medications: 'Metformin',
        allergies: 'None',
        traumas: [{ date: '2020-01-01', bodyPart: 'Ankle', nature: 'Sprain', treatment: 'Rest', sequelae: 'none' as const }],
        previousPainHistory: [{ id: 'p1', region: 'Lumbar' }],
      },
    };
    expect(sectionCompletion('history', complete)).toBe('complete');
  });

  it('reads PSFS as partial with one activity, complete with two or more', () => {
    const base = emptyPayload();
    const oneActivity = {
      ...base,
      functionalStatus: { activities: [{ label: 'Climbing stairs', baseline: 4, baselineDate: '2026-01-01', current: 6 }] },
    };
    expect(sectionCompletion('psfs', oneActivity)).toBe('partial');

    const twoActivities = {
      ...base,
      functionalStatus: {
        activities: [
          { label: 'Climbing stairs', baseline: 4, baselineDate: '2026-01-01', current: 6 },
          { label: 'Sitting 30min', baseline: 3, baselineDate: '2026-01-01', current: 5 },
        ],
      },
    };
    expect(sectionCompletion('psfs', twoActivities)).toBe('complete');
  });

  it('reads Outcome Tracking as complete once there is an NRS or PSFS value to show, empty otherwise', () => {
    const base = emptyPayload();
    expect(sectionCompletion('outcome', base)).toBe('empty');

    const withNrs = { ...base, painProfile: { ...base.painProfile, nrs: { current: 5, best: null, worst: null } } };
    expect(sectionCompletion('outcome', withNrs)).toBe('complete');
  });

  it('treats an untouched neurological screen as not touched even though objective has other data', () => {
    const base = emptyPayload();
    const payload = { ...base, palpation: [{ region: 'L4-L5', findings: ['Tenderness'], painOnPalpation: 'mild' as const, notes: '' }] };
    // 1 of 5 objective sub-parts filled (palpation) -> partial, not complete.
    expect(sectionCompletion('objective', payload)).toBe('partial');
  });
});

describe('frequencyLabel', () => {
  it('formats a full frequency plan', () => {
    expect(frequencyLabel(3, 4)).toBe('3×/week for 4 weeks');
  });

  it('singularizes a one-week plan', () => {
    expect(frequencyLabel(5, 1)).toBe('5×/week for 1 week');
  });

  it('is null when frequency is unset', () => {
    expect(frequencyLabel(null, 4)).toBeNull();
    expect(frequencyLabel(undefined, 4)).toBeNull();
  });

  it('is null when duration is unset', () => {
    expect(frequencyLabel(3, null)).toBeNull();
    expect(frequencyLabel(3, undefined)).toBeNull();
  });

  it('is null when both are unset', () => {
    expect(frequencyLabel(null, null)).toBeNull();
  });
});

describe('outcomeInstrumentDef', () => {
  it('finds a known instrument by id', () => {
    expect(outcomeInstrumentDef('oks')?.label).toBe('Oxford Knee Score (OKS)');
  });

  it('returns undefined for an unknown id', () => {
    expect(outcomeInstrumentDef('not-a-real-instrument')).toBeUndefined();
  });
});

describe('orderedOutcomeInstruments', () => {
  it('returns the full catalog when no region is set', () => {
    expect(orderedOutcomeInstruments('')).toEqual(OUTCOME_INSTRUMENTS);
  });

  it('lists region-applicable instruments first, without hiding the rest', () => {
    const ordered = orderedOutcomeInstruments('Knee');
    expect(ordered).toHaveLength(OUTCOME_INSTRUMENTS.length);
    expect(ordered[0].id).toBe('oks');
    expect(ordered[1].id).toBe('womac');
    // Shoulder-only instruments still present, just pushed later.
    expect(ordered.some((i) => i.id === 'cms')).toBe(true);
  });

  it('lists hip-applicable instruments first for Hip', () => {
    const ordered = orderedOutcomeInstruments('Hip');
    expect(ordered.slice(0, 3).map((i) => i.id).sort()).toEqual(['hhs', 'hoos', 'womac']);
  });
});
