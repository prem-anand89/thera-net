import { describe, expect, it } from 'vitest';
import { syncFailureHeadline, syncRecordLabel } from './syncCopy';

describe('syncFailureHeadline', () => {
  it('uses a human noun for one failed patient write', () => {
    expect(syncFailureHeadline(['patients'])).toBe('1 patient change not saved');
  });

  it('pluralizes the same table', () => {
    expect(syncFailureHeadline(['visits', 'visits'])).toBe('2 visits not saved');
  });
});

describe('syncRecordLabel', () => {
  it('names a visit row', () => {
    expect(syncRecordLabel('visits')).toBe('visit');
  });
});
