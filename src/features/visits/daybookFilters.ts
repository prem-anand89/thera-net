export type DaybookMethodFilter = 'all' | 'cash' | 'upi' | 'card' | 'other' | 'partner';

const NAMED_METHODS = ['cash', 'upi', 'card', 'partner'];

/** Does a transaction's payment method pass the Daybook "Payment mode" filter? "Other" is bank transfer and cheque. */
export function methodMatchesFilter(method: string, filter: DaybookMethodFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'other') return !NAMED_METHODS.includes(method);
  return method === filter;
}
