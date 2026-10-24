import { describe, expect, it } from 'vitest';
import { rupeesToPaise as rs } from '@/domain/money';
import { packageMoveNote } from './packageMoveNote';

const A = { id: 'a', name: 'Dr A' };
const B = { id: 'b', name: 'Dr B' };
const C = { id: 'c', name: 'Dr C' };

describe('packageMoveNote', () => {
  it('the runner is not the biller: the whole session share moves to them', () => {
    expect(packageMoveNote({ amountPaise: rs(1000), biller: A, runner: B })).toBe(
      "₹1,000 of Dr A's package moves for this session: ₹1,000 to Dr B."
    );
  });
  it('the biller runs it and a helper gets a part', () => {
    expect(packageMoveNote({ amountPaise: rs(1000), biller: A, runner: A, helper: { ...B, pct: 40 } })).toBe(
      "₹400 of Dr A's package moves for this session: ₹400 to Dr B."
    );
  });
  it('a colleague runs it and another helps: both are named', () => {
    expect(packageMoveNote({ amountPaise: rs(1000), biller: A, runner: B, helper: { ...C, pct: 30 } })).toBe(
      "₹1,000 of Dr A's package moves for this session: ₹700 to Dr B and ₹300 to Dr C."
    );
  });
  it('says nothing when nothing leaves the biller', () => {
    expect(packageMoveNote({ amountPaise: rs(1000), biller: A, runner: A })).toBeNull();
    expect(packageMoveNote({ amountPaise: 0, biller: A, runner: B })).toBeNull();
    expect(packageMoveNote({ amountPaise: rs(1000), biller: A, runner: B, helper: { ...A, pct: 50 } })).toBe(
      "₹500 of Dr A's package moves for this session: ₹500 to Dr B."
    );
  });
});
