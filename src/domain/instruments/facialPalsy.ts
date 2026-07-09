/**
 * Facial Palsy grading: House–Brackmann (static reference scale) + Sunnybrook
 * Facial Grading System (computed composite score). Ported verbatim from the
 * standalone HB_Sunnybrook_iPad.html tool — same grade descriptions, same
 * Sunnybrook formula, same cross-tool discordance check — so historical
 * paper/HTML-tool scores match this implementation exactly.
 */

export interface HbGradeInfo {
  grade: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  resting: string;
  motion: string;
  description: string;
  management: string;
  prognosis: string;
}

export const HB_GRADES: HbGradeInfo[] = [
  {
    grade: 1,
    label: 'Normal',
    resting: 'Normal symmetry and tone at rest',
    motion: 'Normal movement in all areas',
    description: 'Complete normal facial function. No visible asymmetry at rest or with movement.',
    management: 'No pharmacological treatment required. Reassure patient and document as baseline.',
    prognosis: 'Complete normal function — baseline reference.',
  },
  {
    grade: 2,
    label: 'Mild',
    resting: 'Normal symmetry at rest',
    motion: 'Slight asymmetry on close inspection; complete eye closure with minimal effort; slight mouth asymmetry',
    description:
      'Slight weakness on close inspection only. May have very slight synkinesis. Symmetry normal at rest.',
    management: 'Prednisolone 60mg/day × 10 days. Lubricating eye drops. Gentle massage. Begin mirror-based HEP.',
    prognosis: 'Excellent — >95% complete recovery within 4–6 weeks.',
  },
  {
    grade: 3,
    label: 'Moderate',
    resting: 'Obvious asymmetry — not disfiguring',
    motion: 'Complete eye closure with effort; moderate forehead movement; clearly detectable asymmetry',
    description:
      'Obvious but not disfiguring difference. Complete eye closure with effort. May have obvious (not disfiguring) synkinesis or contracture.',
    management: 'Prednisolone + Acyclovir/Valacyclovir. Full eye care. Physio 2×/week. ENoG if no improvement by day 14.',
    prognosis: 'Good — ~80% achieve HB I–II by 3–6 months.',
  },
  {
    grade: 4,
    label: 'Mod. severe',
    resting: 'Obvious disfiguring weakness and asymmetry',
    motion: 'Incomplete eye closure; asymmetric forehead; asymmetric mouth at maximum effort',
    description: 'Disfiguring asymmetry. Incomplete eye closure — corneal risk. No forehead movement. May have synkinesis / contracture.',
    management: 'Aggressive ocular protection + moisture chamber. ENoG day 3–14. Physio 3×/week. Monitor synkinesis at every session.',
    prognosis: 'Moderate — 60–70% achieve HB II–III by 6 months. Synkinesis and contracture risk.',
  },
  {
    grade: 5,
    label: 'Severe',
    resting: 'Barely perceptible motion; asymmetry at rest',
    motion: 'Incomplete eye closure with significant corneal risk; trace forehead; trace mouth',
    description: 'Barely perceptible movement. Major asymmetry at rest. Significant corneal exposure risk.',
    management: 'Ophthalmology referral same day. Aggressive corneal protection. ENoG urgent. ENT referral for surgical decompression assessment.',
    prognosis: 'Guarded — 50–60% partial recovery. High synkinesis and chronic weakness risk.',
  },
  {
    grade: 6,
    label: 'Total palsy',
    resting: 'Complete flaccid asymmetry — no movement',
    motion: 'No movement whatsoever. No taste, lacrimation, or stapedial reflex.',
    description: 'Complete total palsy. Maximum corneal exposure risk. No facial movement at all.',
    management:
      'Corneal emergency — tape/moisture chamber immediately. ENoG within 72 hrs. ENT urgent if >90% degeneration on ENoG. Max medical therapy.',
    prognosis: 'Poor short-term. ~50% incomplete recovery. Maximum synkinesis risk. Long-term NMR + BoNT-A + surgical planning required.',
  },
];

/** Expected Sunnybrook score per HB grade, used for the discordance check. */
const EXPECTED_SUNNYBROOK_BY_HB_GRADE = [100, 75, 55, 35, 15, 0];

export const SB_RESTING_ITEMS = ['r0', 'r1', 'r2'] as const;
export const SB_VOLUNTARY_ITEMS = ['v0', 'v1', 'v2', 'v3', 'v4'] as const;
export const SB_SYNKINESIS_ITEMS = ['s0', 's1', 's2', 's3', 's4'] as const;

export type SunnybrookRestingScores = Partial<Record<(typeof SB_RESTING_ITEMS)[number], number>>;
export type SunnybrookVoluntaryScores = Partial<Record<(typeof SB_VOLUNTARY_ITEMS)[number], number>>;
export type SunnybrookSynkinesisScores = Partial<Record<(typeof SB_SYNKINESIS_ITEMS)[number], number>>;

function sumItems(items: readonly string[], vals: Record<string, number | undefined>): number | null {
  if (!items.every((i) => vals[i] !== undefined)) return null;
  return items.reduce((a, i) => a + (vals[i] as number), 0);
}

export interface SunnybrookResult {
  restingTotal: number | null;
  voluntaryTotal: number | null;
  synkinesisTotal: number | null;
  /** null until all three sections are complete. */
  score: number | null;
}

/** Sunnybrook composite: voluntary×4 − resting×5 − synkinesis, clamped 0-100. */
export function computeSunnybrook(
  resting: SunnybrookRestingScores,
  voluntary: SunnybrookVoluntaryScores,
  synkinesis: SunnybrookSynkinesisScores
): SunnybrookResult {
  const restingTotal = sumItems(SB_RESTING_ITEMS, resting);
  const voluntaryTotal = sumItems(SB_VOLUNTARY_ITEMS, voluntary);
  const synkinesisTotal = sumItems(SB_SYNKINESIS_ITEMS, synkinesis);

  let score: number | null = null;
  if (restingTotal !== null && voluntaryTotal !== null && synkinesisTotal !== null) {
    score = Math.max(0, Math.min(100, voluntaryTotal * 4 - restingTotal * 5 - synkinesisTotal));
  }
  return { restingTotal, voluntaryTotal, synkinesisTotal, score };
}

export function sunnybrookInterpretation(score: number): { title: string; description: string } {
  if (score <= 25) {
    return { title: 'Severe impairment', description: 'Intensive NMR, mirror biofeedback and passive ROM indicated' };
  }
  if (score <= 50) {
    return { title: 'Moderate impairment', description: 'Active NMR, biofeedback and functional retraining' };
  }
  if (score <= 75) {
    return { title: 'Mild–moderate', description: 'Refine movement quality and monitor for synkinesis' };
  }
  return { title: 'Good to near-normal', description: 'Maintenance programme and monitor for late complications' };
}

export function synkinesisSeverity(total: number): 'none' | 'mild' | 'moderate' | 'severe' {
  if (total === 0) return 'none';
  if (total <= 3) return 'mild';
  if (total <= 7) return 'moderate';
  return 'severe';
}

export interface FacialPalsyFlag {
  color: 'red' | 'amber' | 'purple' | 'blue' | 'green';
  text: string;
}

/** Clinical flags, ported verbatim from the source tool's buildSummary() logic. */
export function facialPalsyFlags(
  hbGrade: number | null,
  sunnybrookScore: number | null,
  synkinesisTotal: number | null
): FacialPalsyFlag[] {
  const flags: FacialPalsyFlag[] = [];
  if (hbGrade != null && hbGrade >= 4) {
    flags.push({
      color: 'red',
      text: 'HB ≥ IV — incomplete eye closure. Urgent corneal protection and consider ophthalmology referral.',
    });
  }
  if (hbGrade != null && hbGrade >= 5) {
    flags.push({
      color: 'red',
      text: 'HB V–VI — ENoG urgently indicated. ENT referral for decompression assessment within 14 days.',
    });
  }
  if (sunnybrookScore != null && sunnybrookScore <= 40) {
    flags.push({
      color: 'purple',
      text: 'Sunnybrook ≤40 — intensive NMR, mirror biofeedback and passive ROM indicated immediately.',
    });
  }
  if (synkinesisTotal != null && synkinesisTotal >= 4) {
    flags.push({
      color: 'purple',
      text: `Synkinesis ${synkinesisTotal}/12 — clinically significant. Start sEMG biofeedback. Consider BoNT-A referral if NMR insufficient.`,
    });
  }
  if (synkinesisTotal != null && synkinesisTotal >= 8) {
    flags.push({
      color: 'red',
      text: 'Severe synkinesis — BoNT-A injection and selective neurolysis consultation warranted urgently.',
    });
  }
  if (hbGrade != null && sunnybrookScore != null) {
    const expected = EXPECTED_SUNNYBROOK_BY_HB_GRADE[hbGrade - 1];
    if (Math.abs(sunnybrookScore - expected) > 20) {
      flags.push({
        color: 'blue',
        text: `HB Grade ${hbGrade} and Sunnybrook ${sunnybrookScore}/100 are discordant by >20 pts. Consider disproportionate synkinesis or atypical recovery pattern.`,
      });
    }
  }
  if (flags.length === 0) {
    flags.push({ color: 'green', text: 'No urgent flags. Continue planned rehabilitation and reassess at next visit.' });
  }
  return flags;
}
