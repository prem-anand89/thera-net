import { describe, expect, it } from 'vitest';
import { joinPhone, splitPhone } from './countryCodes';

describe('splitPhone', () => {
  it('a bare 10-digit number belongs to the default code', () => {
    expect(splitPhone('9876543210')).toEqual({ code: '+91', national: '9876543210' });
  });
  it('drops a leading 0 and a pasted 91 prefix', () => {
    expect(splitPhone('098765 43210')).toEqual({ code: '+91', national: '9876543210' });
    expect(splitPhone('919876543210')).toEqual({ code: '+91', national: '9876543210' });
  });
  it('reads a known +code, longest match first', () => {
    expect(splitPhone('+91 98765 43210')).toEqual({ code: '+91', national: '9876543210' });
    expect(splitPhone('+971 50 123 4567')).toEqual({ code: '+971', national: '501234567' });
    expect(splitPhone('+1 7185942285')).toEqual({ code: '+1', national: '7185942285' });
  });
  it('an unknown + prefix is "other" and keeps the whole number', () => {
    expect(splitPhone('+65 8123 4567')).toEqual({ code: '', national: '+65 8123 4567' });
  });
  it('empty uses the default', () => {
    expect(splitPhone('')).toEqual({ code: '+91', national: '' });
    expect(splitPhone('', '+971')).toEqual({ code: '+971', national: '' });
  });
});

describe('joinPhone', () => {
  it('stores "+code number", and nothing when empty', () => {
    expect(joinPhone('+91', '9876543210')).toBe('+91 9876543210');
    expect(joinPhone('+91', '  ')).toBe('');
  });
  it('drops a typed leading 0 and keeps other numbers as typed', () => {
    expect(joinPhone('+91', '09876543210')).toBe('+91 9876543210');
    expect(joinPhone('', '+65 8123 4567')).toBe('+65 8123 4567');
  });
  it('round-trips through splitPhone', () => {
    const stored = joinPhone('+44', '7911123456');
    expect(splitPhone(stored)).toEqual({ code: '+44', national: '7911123456' });
  });
});

import { tidyPhone } from './countryCodes';

describe('tidyPhone', () => {
  it('drops a country code that was added twice', () => {
    expect(tidyPhone('+91 +91 86882 33328')).toBe('+91 8688233328');
    expect(tidyPhone('+91 +91 733-0834399')).toBe('+91 7330834399');
    expect(tidyPhone('+91 ‪+91 96423 75817‬')).toBe('+91 9642375817');
  });
  it('drops a 91 in front of a 10-digit number only when there are 12 digits', () => {
    expect(tidyPhone('+91 919876543210')).toBe('+91 9876543210');
    expect(tidyPhone('+91 +91 919876543210')).toBe('+91 9876543210');
  });
  it('leaves normal numbers, including ones that start with 91, alone', () => {
    expect(tidyPhone('+91 9123456789')).toBe('+91 9123456789');
    expect(tidyPhone('+91 91234 56789')).toBe('+91 91234 56789');
    expect(tidyPhone('9876543210')).toBe('9876543210');
    expect(tidyPhone('+971 501234567')).toBe('+971 501234567');
    expect(tidyPhone('')).toBe('');
  });
  it('splitPhone reads a doubled number as one', () => {
    expect(splitPhone('+91 +91 86882 33328')).toEqual({ code: '+91', national: '8688233328' });
  });
});

describe('joinPhone with a pasted code', () => {
  it('does not store the country code twice', () => {
    expect(joinPhone('+91', '+91 98765 43210')).toBe('+91 9876543210');
  });
});
