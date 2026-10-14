/**
 * The date cash is recorded as received when it is taken at a visit: the visit
 * date (staff may be logging yesterday's visits), but never later than today —
 * a future-dated visit can't have been paid yet.
 */
export function receivedDateAtVisit(visitDate: string, today: string): string {
  return visitDate < today ? visitDate : today;
}
