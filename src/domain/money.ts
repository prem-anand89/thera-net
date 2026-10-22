/** All money in the system is integer paise (₹1 = 100 paise). */
export type Paise = number;

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: Paise): number {
  return paise / 100;
}

/**
 * Canonical rounding rule for computed splits: round half-up to the whole
 * rupee, applied once per visit. Monthly/therapist rollups sum these stored
 * visit-level values, so report totals always reconcile by construction
 * (the source Excel sheets drifted by ±₹1 because they rounded at different
 * levels in different tables).
 */
export function roundToRupeeHalfUp(paise: number): Paise {
  return Math.floor(paise / 100 + 0.5) * 100;
}

/**
 * Splits `totalPaise` over `weights` in proportion, in whole rupees, so the parts sum exactly to the
 * total — the one largest-remainder rule used for every proportional money split (line nets, revenue
 * shares on clinic share / Post-Tax, a package line's share of its visit):
 * - the total's whole rupees are shared out by largest remainder — each part gets the floor of its exact
 *   share, then the leftover rupees go one each to the largest fractional remainders, ties to the lower
 *   index; zero-weight parts rank last;
 * - stray paise (a total that isn't a whole rupee) go to the part that would have been next in line for
 *   a rupee.
 * Integer arithmetic throughout (remainders compared as `units × weight mod Σweight`), so no float drift.
 * Weights must be ≥ 0 with Σ > 0. A negative total is split as its absolute value, then negated.
 */
export function largestRemainderRupees(weights: number[], totalPaise: Paise): Paise[] {
  const sign = totalPaise < 0 ? -1 : 1;
  const abs = Math.abs(totalPaise);
  const weightSum = weights.reduce((s, w) => s + w, 0);
  const units = Math.floor(abs / 100);
  const strayPaise = abs - units * 100;
  const parts = weights.map((w, idx) => ({
    idx,
    zero: w <= 0,
    rupees: Math.floor((units * w) / weightSum),
    remainder: (units * w) % weightSum,
  }));
  let leftover = units - parts.reduce((s, p) => s + p.rupees, 0);
  const ranking = [...parts].sort(
    (a, b) => Number(a.zero) - Number(b.zero) || b.remainder - a.remainder || a.idx - b.idx,
  );
  let next = 0;
  while (leftover > 0) {
    ranking[next].rupees += 1;
    next += 1;
    leftover -= 1;
  }
  const out = parts.map((p) => p.rupees * 100);
  // `next` < parts.length always: the handed-out rupees are fewer than the parts (Σ fractions < n).
  if (strayPaise > 0) out[ranking[next].idx] += strayPaise;
  return out.map((x) => (x === 0 ? 0 : sign * x));
}

const inrWhole = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const inrExact = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

export function formatINR(paise: Paise): string {
  const rupees = paise / 100;
  return paise % 100 === 0 ? inrWhole.format(rupees) : inrExact.format(rupees);
}
