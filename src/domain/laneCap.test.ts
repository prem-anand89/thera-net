import { describe, expect, it } from 'vitest';
import { capLanes } from './laneCap';

const at = (id: string, start: number, end: number) => ({ id, start, end });

describe('capLanes', () => {
  it('leaves clusters within the cap alone', () => {
    const { visible, overflow } = capLanes([at('a', 600, 660), at('b', 600, 660)], 3);
    expect(overflow).toEqual([]);
    expect(visible.get('a')).toEqual({ lane: 0, lanes: 2, hasOverflow: false });
    expect(visible.get('b')).toEqual({ lane: 1, lanes: 2, hasOverflow: false });
  });

  it('five simultaneous appointments show three lanes and report two hidden', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => at(id, 600, 660));
    const { visible, overflow } = capLanes(items, 3);
    expect([...visible.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(visible.get('a')).toEqual({ lane: 0, lanes: 3, hasOverflow: true });
    expect(overflow).toEqual([{ start: 600, end: 660, hiddenIds: ['d', 'e'] }]);
  });

  it('caps each cluster separately', () => {
    const items = [...['a', 'b', 'c', 'd'].map((id) => at(id, 540, 600)), at('x', 720, 780)];
    const { visible, overflow } = capLanes(items, 3);
    expect(overflow).toHaveLength(1);
    expect(visible.get('x')).toEqual({ lane: 0, lanes: 1, hasOverflow: false });
  });
});
