import { describe, expect, it } from 'vitest';
import {
  HB_GRADES,
  computeSunnybrook,
  facialPalsyFlags,
  sunnybrookInterpretation,
  synkinesisSeverity,
} from './facialPalsy';

// Vectors verified against HB_Sunnybrook_iPad.html's own scoring logic
// (score = voluntary*4 - resting*5 - synkinesis, clamped 0-100) so
// historical paper/HTML-tool scores match this implementation exactly.
describe('computeSunnybrook', () => {
  it('scores 100 for perfect resting symmetry, full voluntary movement, no synkinesis', () => {
    const result = computeSunnybrook(
      { r0: 0, r1: 0, r2: 0 },
      { v0: 5, v1: 5, v2: 5, v3: 5, v4: 5 },
      { s0: 0, s1: 0, s2: 0, s3: 0, s4: 0 }
    );
    expect(result.restingTotal).toBe(0);
    expect(result.voluntaryTotal).toBe(25);
    expect(result.synkinesisTotal).toBe(0);
    expect(result.score).toBe(100);
  });

  it('scores 0 for total palsy (no voluntary movement, max resting asymmetry)', () => {
    const result = computeSunnybrook(
      { r0: 4, r1: 4, r2: 4 },
      { v0: 1, v1: 1, v2: 1, v3: 1, v4: 1 },
      { s0: 0, s1: 0, s2: 0, s3: 0, s4: 0 }
    );
    // voluntary min is 1 per item (not 0) per the source tool's 1-5 scale
    // voluntary*4 = 5*4=20, resting*5 = 12*5=60 -> 20-60 = -40, clamped to 0
    expect(result.score).toBe(0);
  });

  it('clamps negative results to 0 rather than going negative', () => {
    const result = computeSunnybrook({ r0: 4, r1: 4, r2: 4 }, { v0: 1, v1: 1, v2: 1, v3: 1, v4: 1 }, { s0: 3, s1: 3, s2: 3, s3: 3, s4: 3 });
    expect(result.score).toBe(0);
  });

  it('returns null score until all three sections are complete', () => {
    const result = computeSunnybrook({ r0: 0, r1: 0, r2: 0 }, {}, {});
    expect(result.score).toBeNull();
    expect(result.restingTotal).toBe(0);
    expect(result.voluntaryTotal).toBeNull();
  });
});

describe('sunnybrookInterpretation', () => {
  it('bands scores into the four severity tiers used by the source tool', () => {
    expect(sunnybrookInterpretation(20).title).toContain('Severe');
    expect(sunnybrookInterpretation(45).title).toContain('Moderate');
    expect(sunnybrookInterpretation(70).title).toContain('Mild');
    expect(sunnybrookInterpretation(90).title).toContain('Good');
  });
});

describe('synkinesisSeverity', () => {
  it('bands totals exactly as the source tool does (0/1-3/4-7/8+)', () => {
    expect(synkinesisSeverity(0)).toBe('none');
    expect(synkinesisSeverity(3)).toBe('mild');
    expect(synkinesisSeverity(4)).toBe('moderate');
    expect(synkinesisSeverity(7)).toBe('moderate');
    expect(synkinesisSeverity(8)).toBe('severe');
    expect(synkinesisSeverity(12)).toBe('severe');
  });
});

describe('HB_GRADES', () => {
  it('has exactly 6 grades, numbered 1-6 in order', () => {
    expect(HB_GRADES).toHaveLength(6);
    HB_GRADES.forEach((g, i) => expect(g.grade).toBe(i + 1));
  });
});

describe('facialPalsyFlags', () => {
  it('flags HB >= IV for urgent corneal protection', () => {
    const flags = facialPalsyFlags(4, 90, 0);
    expect(flags.some((f) => f.text.includes('HB ≥ IV'))).toBe(true);
  });

  it('flags HB >= V for urgent ENoG/ENT referral (in addition to the HB IV flag)', () => {
    const flags = facialPalsyFlags(5, 90, 0);
    expect(flags.some((f) => f.text.includes('HB V–VI'))).toBe(true);
    expect(flags.some((f) => f.text.includes('HB ≥ IV'))).toBe(true);
  });

  it('flags Sunnybrook <= 40 for intensive NMR', () => {
    const flags = facialPalsyFlags(2, 40, 0);
    expect(flags.some((f) => f.text.includes('Sunnybrook ≤40'))).toBe(true);
  });

  it('flags synkinesis >= 4 as clinically significant, and >= 8 as severe (both fire together)', () => {
    const flags = facialPalsyFlags(2, 90, 8);
    expect(flags.some((f) => f.text.includes('clinically significant'))).toBe(true);
    expect(flags.some((f) => f.text.includes('Severe synkinesis'))).toBe(true);
  });

  it('flags discordance when HB grade and Sunnybrook score disagree by >20 points', () => {
    // HB grade 1 expects Sunnybrook ~100; scoring 70 is a 30-point gap.
    const flags = facialPalsyFlags(1, 70, 0);
    expect(flags.some((f) => f.text.includes('discordant'))).toBe(true);
  });

  it('does not flag discordance when scores are concordant', () => {
    const flags = facialPalsyFlags(1, 95, 0);
    expect(flags.some((f) => f.text.includes('discordant'))).toBe(false);
  });

  it('reports no urgent flags for a clean grade-1 / score-100 result', () => {
    const flags = facialPalsyFlags(1, 100, 0);
    expect(flags).toHaveLength(1);
    expect(flags[0].text).toContain('No urgent flags');
  });
});
