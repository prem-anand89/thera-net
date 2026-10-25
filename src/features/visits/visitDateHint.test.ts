import { describe, expect, it } from 'vitest';
import { visitDateHint } from './visitDateHint';

describe('visitDateHint', () => {
  const today = '2026-10-25';
  it('says nothing for today or an unreadable date', () => {
    expect(visitDateHint('2026-10-25', today)).toBeNull();
    expect(visitDateHint('', today)).toBeNull();
  });
  it('names the past', () => {
    expect(visitDateHint('2026-10-24', today)).toEqual({ text: 'Yesterday', tone: 'muted' });
    expect(visitDateHint('2026-10-22', today)).toEqual({ text: '3 days ago', tone: 'muted' });
  });
  it('warns about the future', () => {
    expect(visitDateHint('2026-10-26', today)).toEqual({ text: 'Tomorrow — check the date', tone: 'warn' });
    expect(visitDateHint('2026-10-27', today)).toEqual({ text: 'In 2 days — check the date', tone: 'warn' });
  });
  it('counts across a month and a clock change', () => {
    expect(visitDateHint('2026-09-30', '2026-10-02')).toEqual({ text: '2 days ago', tone: 'muted' });
    expect(visitDateHint('2026-03-28', '2026-03-30')?.text).toBe('2 days ago');
  });
});
