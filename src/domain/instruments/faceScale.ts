/**
 * FaCE Scale (Facial Clinimetric Evaluation, Kahn et al. 2001) scoring.
 * Ported verbatim from the standalone FaCE_Original_iPad.html tool — same
 * item groupings, same reverse-scored items, same domain formula — so
 * historical paper/HTML-tool scores match this implementation exactly.
 *
 * 15 Likert items (raw score 1-5 each), grouped into 6 domains. Domain
 * score = ((sum of item scores − N) / (4N)) × 100, with reverse-scored
 * items transformed via (6 − raw) before summing. Total = mean of domains.
 */

export type FaceScaleRaw = 1 | 2 | 3 | 4 | 5;
export type FaceScaleResponses = Partial<Record<number, FaceScaleRaw>>;

export const FACE_SCALE_REVERSE_ITEMS = [9, 10, 13, 14, 15] as const;

export interface FaceScaleDomainScores {
  facialMovement: number;
  facialComfort: number;
  oralFunction: number;
  eyeComfort: number;
  lacrimalControl: number;
  socialFunction: number;
}

export interface FaceScaleResult {
  domainScores: FaceScaleDomainScores;
  total: number;
}

/** Missing answers default to the neutral midpoint (3), matching the source tool. */
function rawScore(responses: FaceScaleResponses, item: number): number {
  return responses[item] ?? 3;
}

function itemScore(responses: FaceScaleResponses, item: number, reverse: boolean): number {
  const raw = rawScore(responses, item);
  return reverse ? 6 - raw : raw;
}

function domainScore(responses: FaceScaleResponses, items: number[], reverseItems: number[]): number {
  const vals = items.map((n) => itemScore(responses, n, reverseItems.includes(n)));
  const sum = vals.reduce((a, b) => a + b, 0);
  const n = vals.length;
  return Math.round(((sum - n) / (4 * n)) * 100);
}

export function computeFaceScale(responses: FaceScaleResponses): FaceScaleResult {
  const facialMovement = domainScore(responses, [1, 2, 3], []);
  const facialComfort = domainScore(responses, [4, 6], []);
  const oralFunction = domainScore(responses, [11, 12], []);
  const eyeComfort = domainScore(responses, [5, 7], []);
  const lacrimalControl = domainScore(responses, [8, 9, 10, 15], [9, 10, 15]);

  const allItems = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const socialFunction = domainScore(responses, allItems, [...FACE_SCALE_REVERSE_ITEMS]);

  const domainScores: FaceScaleDomainScores = {
    facialMovement,
    facialComfort,
    oralFunction,
    eyeComfort,
    lacrimalControl,
    socialFunction,
  };
  const domainValues = Object.values(domainScores);
  const total = Math.round(domainValues.reduce((a, b) => a + b, 0) / domainValues.length);

  return { domainScores, total };
}

export interface FaceScaleFlag {
  color: 'red' | 'amber' | 'green';
  text: string;
}

/** Clinical flags, ported verbatim from the source tool's showResults() logic. */
export function faceScaleFlags(
  domainScores: FaceScaleDomainScores,
  vasQol: number | null
): FaceScaleFlag[] {
  const flags: FaceScaleFlag[] = [];
  if (domainScores.eyeComfort < 50) {
    flags.push({
      color: 'red',
      text: 'Eye Comfort low — review corneal protection immediately. Consider ophthalmology referral.',
    });
  }
  if (domainScores.facialMovement < 40) {
    flags.push({
      color: 'red',
      text: 'Facial Movement severely limited — ENoG/EMG workup recommended if not already performed.',
    });
  }
  if (domainScores.socialFunction < 40) {
    flags.push({
      color: 'amber',
      text: 'Social Function significantly impacted — psychosocial support and counselling referral warranted.',
    });
  }
  if (domainScores.oralFunction < 40) {
    flags.push({
      color: 'amber',
      text: 'Oral Function impaired — oral motor therapy and dietitian referral to consider.',
    });
  }
  if (domainScores.lacrimalControl < 40) {
    flags.push({
      color: 'green',
      text: 'Lacrimal Control affected — gustatory epiphora may indicate aberrant reinnervation. Document and monitor.',
    });
  }
  if (vasQol != null && vasQol >= 7) {
    flags.push({
      color: 'red',
      text: `Quality-of-life impact rated ${vasQol}/10 — patient may benefit from psychological or peer support referral.`,
    });
  }
  if (flags.length === 0) {
    flags.push({ color: 'green', text: 'No urgent flags identified. Continue planned rehabilitation and reassess at next visit.' });
  }
  return flags;
}

export function faceScaleInterpretation(total: number): { title: string; description: string } {
  if (total <= 25) {
    return {
      title: `Severe impairment (${total}/100)`,
      description:
        'Major limitation across most domains. Intensive physiotherapy, medical review and corneal protection urgently indicated.',
    };
  }
  if (total <= 50) {
    return {
      title: `Moderate impairment (${total}/100)`,
      description: 'Active NMR, mirror biofeedback and functional retraining recommended. Prioritise eye and oral function.',
    };
  }
  if (total <= 75) {
    return {
      title: `Mild–moderate impairment (${total}/100)`,
      description: 'Partial recovery. Focus on synkinesis management, movement quality and social reintegration.',
    };
  }
  return {
    title: `Good to near-normal function (${total}/100)`,
    description: 'Maintenance programme. Monitor for late synkinesis or contracture. Continue patient-reported outcome tracking.',
  };
}
