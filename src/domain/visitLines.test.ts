import { describe, expect, it } from 'vitest';
import {
  autoCredits,
  deliverer,
  lineNets,
  rebalanceCredits,
  therapistMinutes,
} from './visitLines';
import { rupeesToPaise as rs } from './money';
import type { VisitItem } from './types';

const R = 'dr-r';
const S = 'dr-s';
const T = 'dr-t';

let seq = 0;
function line(over: Partial<VisitItem> & { pricePaise: number }): VisitItem {
  seq += 1;
  return {
    id: over.id ?? `item-${seq}`,
    clinicId: 'clinic',
    visitId: 'visit',
    position: over.position ?? seq,
    serviceCatalogId: 'svc',
    serviceName: 'Service',
    catalogPricePaise: over.pricePaise,
    assistingTherapistId: null,
    durationMinutes: null,
    isPackageLine: false,
    deleted: false,
    updatedAt: '2026-10-23T00:00:00Z',
    ...over,
  };
}

describe('deliverer', () => {
  it('is the primary unless an assistant is tagged', () => {
    expect(deliverer({ assistingTherapistId: null }, R)).toBe(R);
    expect(deliverer({ assistingTherapistId: S }, R)).toBe(S);
  });
});

describe('lineNets', () => {
  it('spreads a discount by largest remainder', () => {
    const a = line({ id: 'a', position: 0, pricePaise: rs(1000) });
    const b = line({ id: 'b', position: 1, pricePaise: rs(500), assistingTherapistId: S });
    const nets = lineNets([a, b], rs(1300));
    expect(nets.get('a')).toBe(rs(867));
    expect(nets.get('b')).toBe(rs(433));
  });

  it('three lines and a discount sum exactly', () => {
    const items = [
      line({ id: 'a', position: 0, pricePaise: rs(1000) }),
      line({ id: 'b', position: 1, pricePaise: rs(500) }),
      line({ id: 'c', position: 2, pricePaise: rs(333) }),
    ];
    const nets = lineNets(items, rs(1633));
    const values = [...nets.values()];
    expect(values.reduce((s, v) => s + v, 0)).toBe(rs(1633));
    for (const v of values) expect(v % 100).toBe(0);
    // Σ price ₹1,833, bill ₹1,633: exact shares 890.89 / 445.44 / 296.66 → floors 890/445/296,
    // the 2 leftover rupees go to the largest remainders (a, then c).
    expect(nets.get('a')).toBe(rs(891));
    expect(nets.get('b')).toBe(rs(445));
    expect(nets.get('c')).toBe(rs(297));

    const undiscounted = lineNets(items, rs(1833));
    expect([...undiscounted.values()]).toEqual([rs(1000), rs(500), rs(333)]);
  });

  it('tiny bills never go negative', () => {
    const items = [
      line({ id: 'a', position: 0, pricePaise: rs(1000) }),
      line({ id: 'b', position: 1, pricePaise: rs(500) }),
      line({ id: 'c', position: 2, pricePaise: rs(333) }),
    ];
    const nets = lineNets(items, 100);
    expect([...nets.values()].reduce((s, v) => s + v, 0)).toBe(100);
    for (const v of nets.values()) expect(v).toBeGreaterThanOrEqual(0);
    expect(nets.get('a')).toBe(100);
  });

  it('puts leftover paise on the line next in line for a rupee, so the sum is exact', () => {
    const items = [
      line({ id: 'a', position: 0, pricePaise: rs(1000) }),
      line({ id: 'b', position: 1, pricePaise: rs(500) }),
    ];
    const nets = lineNets(items, rs(1300) + 50);
    expect(nets.get('a')).toBe(rs(867));
    expect(nets.get('b')).toBe(rs(433) + 50);
  });

  it('never puts stray paise on a zero-price line while a priced line exists', () => {
    const items = [
      line({ id: 'free', position: 0, pricePaise: 0, isPackageLine: true }),
      line({ id: 'paid', position: 1, pricePaise: rs(1000) }),
    ];
    const nets = lineNets(items, rs(1000) + 50);
    expect(nets.get('free')).toBe(0);
    expect(nets.get('paid')).toBe(rs(1000) + 50);
  });

  it('breaks ties by position, then id', () => {
    const items = [
      line({ id: 'z', position: 1, pricePaise: rs(100) }),
      line({ id: 'y', position: 0, pricePaise: rs(100) }),
    ];
    const nets = lineNets(items, rs(101));
    expect(nets.get('y')).toBe(rs(51));
    expect(nets.get('z')).toBe(rs(50));
  });

  it('all-zero prices put everything on the first line and ignores deleted lines', () => {
    const items = [
      line({ id: 'gone', position: 0, pricePaise: rs(900), deleted: true }),
      line({ id: 'b', position: 2, pricePaise: 0 }),
      line({ id: 'a', position: 1, pricePaise: 0 }),
    ];
    const nets = lineNets(items, rs(200));
    expect(nets.get('a')).toBe(rs(200));
    expect(nets.get('b')).toBe(0);
    expect(nets.has('gone')).toBe(false);
  });
});

describe('autoCredits', () => {
  it('sums nets per deliverer, primary first', () => {
    const items = [
      line({ position: 0, pricePaise: rs(1000) }),
      line({ position: 1, pricePaise: rs(500), assistingTherapistId: S }),
    ];
    expect(autoCredits(items, R, rs(1300), { splitEnabled: true })).toEqual([
      { therapistId: R, amountPaise: rs(867) },
      { therapistId: S, amountPaise: rs(433) },
    ]);
  });

  it('zero bill gives one zero primary row', () => {
    const items = [
      line({ position: 0, pricePaise: 0, isPackageLine: true }),
      line({ position: 1, pricePaise: 0, assistingTherapistId: S }),
    ];
    expect(autoCredits(items, R, 0, { splitEnabled: true })).toEqual([
      { therapistId: R, amountPaise: 0 },
    ]);
  });

  it("package money stays with the package line's deliverer", () => {
    // Package bought today, run by an assistant; consultation by the primary.
    const items = [
      line({ position: 0, pricePaise: rs(800) }),
      line({ position: 1, pricePaise: rs(5000), isPackageLine: true, assistingTherapistId: S }),
      line({ position: 2, pricePaise: rs(200), assistingTherapistId: T }),
      line({ position: 3, pricePaise: rs(300), assistingTherapistId: S }),
    ];
    const credits = autoCredits(items, R, rs(6300), { splitEnabled: true });
    expect(credits).toEqual([
      { therapistId: R, amountPaise: rs(800) },
      { therapistId: S, amountPaise: rs(5300) },
      { therapistId: T, amountPaise: rs(200) },
    ]);
  });

  it('keeps the primary present even with no lines of their own', () => {
    const items = [line({ position: 0, pricePaise: rs(500), assistingTherapistId: S })];
    expect(autoCredits(items, R, rs(500), { splitEnabled: true })).toEqual([
      { therapistId: R, amountPaise: 0 },
      { therapistId: S, amountPaise: rs(500) },
    ]);
  });

  it('no live lines gives one primary row equal to the bill', () => {
    expect(autoCredits([], R, rs(500), { splitEnabled: true })).toEqual([
      { therapistId: R, amountPaise: rs(500) },
    ]);
    const onlyDeleted = [line({ position: 0, pricePaise: rs(500), deleted: true, assistingTherapistId: S })];
    expect(autoCredits(onlyDeleted, R, rs(500), { splitEnabled: true })).toEqual([
      { therapistId: R, amountPaise: rs(500) },
    ]);
  });

  it('split off gives everything to the primary', () => {
    const items = [
      line({ position: 0, pricePaise: rs(1000) }),
      line({ position: 1, pricePaise: rs(500), assistingTherapistId: S }),
    ];
    expect(autoCredits(items, R, rs(1300), { splitEnabled: false })).toEqual([
      { therapistId: R, amountPaise: rs(1300) },
    ]);
  });
});

describe('rebalanceCredits', () => {
  const current = [
    { therapistId: R, amountPaise: rs(867) },
    { therapistId: S, amountPaise: rs(433) },
  ];

  it('rebalance keeps the total and moves the remainder to the primary', () => {
    const byAmount = rebalanceCredits(current, { therapistId: S, amountPaise: rs(600) }, R, rs(1300), null);
    expect(byAmount).toEqual([
      { therapistId: R, amountPaise: rs(700) },
      { therapistId: S, amountPaise: rs(600) },
    ]);

    const byPct = rebalanceCredits(current, { therapistId: S, pct: 50 }, R, rs(1300), null);
    expect(byPct).toEqual([
      { therapistId: R, amountPaise: rs(650) },
      { therapistId: S, amountPaise: rs(650) },
    ]);

    // ₹ wins over %; a new therapist gets a row; total stays the bill.
    const added = rebalanceCredits(current, { therapistId: T, amountPaise: rs(100), pct: 90 }, R, rs(1300), null);
    expect(added).toEqual([
      { therapistId: R, amountPaise: rs(767) },
      { therapistId: S, amountPaise: rs(433) },
      { therapistId: T, amountPaise: rs(100) },
    ]);
    expect(added.reduce((s, r) => s + r.amountPaise, 0)).toBe(rs(1300));
  });

  it('rebalance refuses a share above bill less package money', () => {
    const msg = "A share can't be more than the bill (less package money).";
    expect(() =>
      rebalanceCredits(current, { therapistId: S, amountPaise: rs(1100) }, R, rs(1300), { therapistId: R, amountPaise: rs(300) }),
    ).toThrow(msg);
    expect(() =>
      rebalanceCredits(current, { therapistId: S, amountPaise: -100 }, R, rs(1300), null),
    ).toThrow("A share can't be less than ₹0.");
    // Another row's share pushes the primary below ₹0.
    expect(() =>
      rebalanceCredits(current, { therapistId: T, amountPaise: rs(1000) }, R, rs(1300), null),
    ).toThrow(msg);
    // Exactly bill less package money is fine.
    expect(
      rebalanceCredits(current, { therapistId: S, amountPaise: rs(1000) }, R, rs(1300), { therapistId: R, amountPaise: rs(300) }),
    ).toEqual([
      { therapistId: R, amountPaise: rs(300) },
      { therapistId: S, amountPaise: rs(1000) },
    ]);
  });
});

describe('rebalanceCredits with package money', () => {
  it('package delivered by an assistant keeps its money when shares are edited', () => {
    // Package ₹5,000 delivered by S; S also did a ₹300 add-on; R did the ₹1,000 consultation.
    const current = [
      { therapistId: R, amountPaise: rs(1000) },
      { therapistId: S, amountPaise: rs(5300) },
    ];
    const locked = { therapistId: S, amountPaise: rs(5000) };
    expect(rebalanceCredits(current, { therapistId: S, amountPaise: rs(5300) }, R, rs(6300), locked)).toEqual(
      current,
    );
    expect(() =>
      rebalanceCredits(current, { therapistId: S, amountPaise: rs(1000) }, R, rs(6300), locked),
    ).toThrow("A share can't be less than the package money it holds.");
    expect(rebalanceCredits(current, { therapistId: S, amountPaise: rs(6000) }, R, rs(6300), locked)).toEqual([
      { therapistId: R, amountPaise: rs(300) },
      { therapistId: S, amountPaise: rs(6000) },
    ]);
    // The primary holds no package money here, so its floor is ₹0.
    expect(() =>
      rebalanceCredits(current, { therapistId: S, amountPaise: rs(6400) }, R, rs(6300), locked),
    ).toThrow("A share can't be more than the bill (less package money).");
  });

  it('an edit with neither ₹ nor a finite % is refused', () => {
    const current = [{ therapistId: R, amountPaise: rs(1000) }];
    const msg = 'Enter the share in ₹ or as a % of the bill.';
    expect(() => rebalanceCredits(current, { therapistId: S }, R, rs(1000), null)).toThrow(msg);
    expect(() => rebalanceCredits(current, { therapistId: S, pct: Number.NaN }, R, rs(1000), null)).toThrow(msg);
    expect(() =>
      rebalanceCredits(current, { therapistId: S, amountPaise: Number.NaN }, R, rs(1000), null),
    ).toThrow(msg);
  });
});

describe('therapistMinutes', () => {
  it('minutes: all durations sum', () => {
    const items = [
      line({ position: 0, pricePaise: rs(1000), durationMinutes: 30 }),
      line({ position: 1, pricePaise: rs(500), durationMinutes: 15 }),
      line({ position: 2, pricePaise: rs(500), assistingTherapistId: S, durationMinutes: 10 }),
    ];
    expect(therapistMinutes(items, R, R, 60)).toBe(45);
    expect(therapistMinutes(items, R, S, 60)).toBe(10);
    expect(therapistMinutes(items, R, T, 60)).toBe(0);
  });

  it('durations longer than the sitting are capped at the sitting', () => {
    const items = [
      line({ position: 0, pricePaise: rs(1000), durationMinutes: 30 }),
      line({ position: 1, pricePaise: rs(500), durationMinutes: 30 }),
    ];
    expect(therapistMinutes(items, R, R, 45)).toBe(45);
  });

  it('minutes: any missing duration counts the sitting once', () => {
    const items = [
      line({ position: 0, pricePaise: rs(1000), durationMinutes: 30 }),
      line({ position: 1, pricePaise: rs(500), assistingTherapistId: S, durationMinutes: null }),
      line({ position: 2, pricePaise: rs(500), assistingTherapistId: S, durationMinutes: 20 }),
    ];
    expect(therapistMinutes(items, R, S, 45)).toBe(45);
    expect(therapistMinutes(items, R, R, 45)).toBe(30);
  });

  it('minutes: two primary lines never exceed the sitting', () => {
    const items = [
      line({ position: 0, pricePaise: rs(1000) }),
      line({ position: 1, pricePaise: rs(500) }),
      line({ position: 2, pricePaise: rs(500), deleted: true, assistingTherapistId: T, durationMinutes: 5 }),
    ];
    expect(therapistMinutes(items, R, R, 45)).toBe(45);
    // Deleted lines don't put a therapist on the visit.
    expect(therapistMinutes(items, R, T, 45)).toBe(0);
  });
});
