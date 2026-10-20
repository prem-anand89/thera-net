/** Load dots under a day: 1–2 booked → 1, 3–5 → 2, 6+ → 3. */
export function loadDots(booked: number): number {
  if (booked <= 0) return 0;
  if (booked <= 2) return 1;
  if (booked <= 5) return 2;
  return 3;
}
