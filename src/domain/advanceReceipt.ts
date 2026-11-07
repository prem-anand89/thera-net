import type { PatientAdvance } from './types';

/**
 * How an advance is named on its receipt and wherever a payment drawn from it is shown. There is no gap-free series
 * for advances yet, so it is the date plus a short slice of the id.
 */
export function advanceReceiptLabel(advance: Pick<PatientAdvance, 'receivedDate' | 'id'>): string {
  return `ADV-${advance.receivedDate.replace(/-/g, '')}-${advance.id.slice(0, 6).toUpperCase()}`;
}
