import { describe, expect, it } from 'vitest';
import { computeFaceScale, faceScaleFlags, faceScaleInterpretation } from './faceScale';

// Vectors verified against FaCE_Original_iPad.html's own scoring logic
// (domScore = round(((sum - N) / (4N)) * 100)) so historical paper/HTML-tool
// scores match this implementation exactly.
describe('computeFaceScale', () => {
  it('scores every domain at 50 when every item is answered at the neutral midpoint (3)', () => {
    const responses = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [i + 1, 3])) as Record<
      number,
      1 | 2 | 3 | 4 | 5
    >;
    const { domainScores, total } = computeFaceScale(responses);
    expect(domainScores.facialMovement).toBe(50);
    expect(domainScores.facialComfort).toBe(50);
    expect(domainScores.oralFunction).toBe(50);
    expect(domainScores.eyeComfort).toBe(50);
    expect(domainScores.lacrimalControl).toBe(50);
    expect(domainScores.socialFunction).toBe(50);
    expect(total).toBe(50);
  });

  it('scores facialMovement at 100 when items 1-3 are all answered at the best option (5)', () => {
    const { domainScores } = computeFaceScale({ 1: 5, 2: 5, 3: 5 });
    expect(domainScores.facialMovement).toBe(100);
  });

  it('scores facialMovement at 0 when items 1-3 are all answered at the worst option (1)', () => {
    const { domainScores } = computeFaceScale({ 1: 1, 2: 1, 3: 1 });
    expect(domainScores.facialMovement).toBe(0);
  });

  it('reverses lacrimalControl items 9, 10, 15 before summing', () => {
    // Item 8 is not reverse-scored; items 9, 10, 15 are. Raw 5 on every item
    // (including the reversed ones) mixes a "best" non-reversed answer with
    // "worst" reversed ones, so the domain score should land well below 100.
    const mixedRaw5 = computeFaceScale({ 8: 5, 9: 5, 10: 5, 15: 5 }).domainScores.lacrimalControl;
    expect(mixedRaw5).toBe(25);

    // Raw 1 on the reversed items (6-1=5, the best possible reversed score)
    // combined with raw 5 on the non-reversed item should hit the domain max.
    const trueBest = computeFaceScale({ 8: 5, 9: 1, 10: 1, 15: 1 }).domainScores.lacrimalControl;
    expect(trueBest).toBe(100);
  });

  it('missing answers default to the neutral midpoint (3), matching the source tool', () => {
    const { domainScores } = computeFaceScale({});
    expect(domainScores.facialMovement).toBe(50);
  });
});

describe('faceScaleFlags', () => {
  const midDomains = {
    facialMovement: 50,
    facialComfort: 50,
    oralFunction: 50,
    eyeComfort: 50,
    lacrimalControl: 50,
    socialFunction: 50,
  };

  it('flags low Eye Comfort for urgent corneal review', () => {
    const flags = faceScaleFlags({ ...midDomains, eyeComfort: 49 }, null);
    expect(flags.some((f) => f.text.includes('Eye Comfort low'))).toBe(true);
  });

  it('flags high QoL VAS (>=7) for psychological support referral', () => {
    const flags = faceScaleFlags(midDomains, 7);
    expect(flags.some((f) => f.text.includes('Quality-of-life impact'))).toBe(true);
  });

  it('reports no urgent flags when nothing crosses a threshold', () => {
    const flags = faceScaleFlags(midDomains, 3);
    expect(flags).toHaveLength(1);
    expect(flags[0].text).toContain('No urgent flags');
  });
});

describe('faceScaleInterpretation', () => {
  it('bands scores into the four severity tiers used by the source tool', () => {
    expect(faceScaleInterpretation(20).title).toContain('Severe');
    expect(faceScaleInterpretation(50).title).toContain('Moderate');
    expect(faceScaleInterpretation(75).title).toContain('Mild');
    expect(faceScaleInterpretation(90).title).toContain('Good');
  });
});
