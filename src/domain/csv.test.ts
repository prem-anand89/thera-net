import { describe, expect, it } from 'vitest';
import { csvMinimal, csvQuoted, neutraliseFormula } from './csv';

describe('neutraliseFormula', () => {
  it.each(['=1+1', '+cmd', '-foo', '@SUM(A1)', '\t=1+1', '\r=1', '=HYPERLINK("http://x","y")'])('prefixes %j', (v) => {
    expect(neutraliseFormula(v)).toBe(`'${v}`);
  });
  it('leaves numbers and plain numeric text alone', () => {
    expect(neutraliseFormula(-125.5)).toBe('-125.5');
    expect(neutraliseFormula('-125.50')).toBe('-125.50');
    expect(neutraliseFormula('+91')).toBe('+91');
    expect(neutraliseFormula('0')).toBe('0');
  });
  it('leaves ordinary text and empty values alone', () => {
    expect(neutraliseFormula('Knee pain')).toBe('Knee pain');
    expect(neutraliseFormula(null)).toBe('');
    expect(neutraliseFormula(undefined)).toBe('');
  });
});

describe('csvQuoted / csvMinimal', () => {
  it('quotes and doubles quotes', () => {
    expect(csvQuoted('say "hi"')).toBe('"say ""hi"""');
    expect(csvQuoted('=1+1')).toBe(`"'=1+1"`);
  });
  it('csvMinimal quotes only when needed', () => {
    expect(csvMinimal('plain')).toBe('plain');
    expect(csvMinimal('a,b')).toBe('"a,b"');
    expect(csvMinimal('@x')).toBe("'@x");
  });
});
