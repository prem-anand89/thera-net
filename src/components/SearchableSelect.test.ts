import { describe, expect, it } from 'vitest';
import { filterSearchableOptions } from './SearchableSelect';

const options = [
  { value: '1', label: 'Initial Consultation — ₹800', group: 'Assessment' },
  { value: '2', label: 'Manual therapy — ₹600', group: 'Treatment' },
  { value: '3', label: 'IFT 20 min — ₹400', group: 'Treatment' },
];

describe('filterSearchableOptions', () => {
  it('returns all options when the query is blank', () => {
    expect(filterSearchableOptions(options, '  ')).toEqual(options);
  });

  it('matches a service name regardless of case', () => {
    expect(filterSearchableOptions(options, 'manual')).toEqual([options[1]]);
  });

  it('matches a group heading so typing Treatment lists those services', () => {
    expect(filterSearchableOptions(options, 'treat')).toEqual([options[1], options[2]]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterSearchableOptions(options, 'xyz')).toEqual([]);
  });
});
