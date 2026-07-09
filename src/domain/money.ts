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
