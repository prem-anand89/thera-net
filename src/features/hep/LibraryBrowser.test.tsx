// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { Exercise } from '@/domain/hep';
import { LibraryBrowser } from './LibraryBrowser';

vi.mock('@/services/hepMediaService', () => ({
  hepMediaService: { mintViewUrls: async (_c: string, keys: string[]) => Object.fromEntries(keys.map((k) => [k, `https://img.test/${k}`])) },
}));
beforeEach(() => { try { localStorage.clear(); } catch { /* ignore */ } });
afterEach(cleanup);

const ex = (id: string, title: string, over: Partial<Exercise> = {}): Exercise => ({
  id, clinicId: 'c1', title, positions: [], otherNames: [], bodyRegion: 'Knee', alsoRegions: [], equipment: [], phase: 'strengthening', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [],
  thumbKey: null, defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'none', stopIf: '',
  isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '', ...over,
});

const LIB = [
  ex('1', 'Quad Sets', { phase: 'activation', equipment: ['Towel'], isFavorite: true, doseType: 'hold', defaultHoldSeconds: 10, defaultReps: 12, positions: ['Supine'] }),
  ex('2', 'Hamstring Stretch', { phase: 'stretching', alsoRegions: ['Hip'], equipment: ['Towel'], positions: ['Supine', 'Sitting'] }),
  ex('3', 'Banded Side Steps', { bodyRegion: 'Hip', alsoRegions: ['Knee'], equipment: ['Theraband / resistance band'], positions: ['Standing'] }),
  ex('4', 'Glute Bridge', { bodyRegion: 'Hip', alsoRegions: ['Pelvic floor: Women'], equipment: ['Mat'], thumbKey: 'clinics/c1/exercises/e4/thumb-aaaaaaaa' }),
  ex('5', 'Pelvic Floor Squeeze', { bodyRegion: 'Pelvic floor: Men', phase: 'activation', thumbKey: 'clinics/c1/exercises/e5/thumb-bbbbbbbb' }),
  ex('6', 'Cheek Puffs', { bodyRegion: 'Face', phase: 'activation', thumbKey: 'clinics/c1/exercises/e6/thumb-cccccccc', mediaType: 'gif', mediaKeys: ['clinics/c1/exercises/e6/0-cccccccc'] }),
  ex('7', 'Straight Leg Raise', { bodyRegion: 'Hip', otherNames: ['SLR'] }),
];

function setup(props: Partial<React.ComponentProps<typeof LibraryBrowser>> = {}) {
  const onActivate = vi.fn();
  const utils = render(<LibraryBrowser clinicId="c1" exercises={LIB} usedIds={new Set()} onActivate={onActivate} {...props} />);
  return { onActivate, ...utils };
}
const group = (name: string) => within(screen.getByRole('group', { name }));
const names = () => screen.getAllByRole('button').map((b) => b.textContent ?? '');

describe('LibraryBrowser', () => {
  it('shows one flat result set with counts on region, type and position values', () => {
    setup();
    expect(screen.queryByRole('heading')).toBeNull();
    expect(group('Body region').getByRole('button', { name: /^Hip/ })).toHaveTextContent('4');
    expect(group('Type').getByRole('button', { name: /^Activation/ })).toHaveTextContent('3');
    expect(group('Position').getByRole('button', { name: /^Supine/ })).toHaveTextContent('2');
  });

  it('a Position chip narrows the results and shows as a removable chip, with Clear all', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(group('Position').getByRole('button', { name: /^Supine/ }));
    expect(screen.getByText('Quad Sets')).toBeInTheDocument();
    expect(screen.getByText('Hamstring Stretch')).toBeInTheDocument();
    expect(screen.queryByText('Glute Bridge')).toBeNull();
    const active = screen.getByLabelText('Active filters');
    expect(within(active).getByText('2 exercises')).toBeInTheDocument();
    await user.click(within(active).getByRole('button', { name: 'Supine ✕' }));
    expect(screen.getByText('Glute Bridge')).toBeInTheDocument();
    await user.click(group('Position').getByRole('button', { name: /^Supine/ }));
    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(screen.queryByLabelText('Active filters')).toBeNull();
  });

  it('counts an exercise under its also-regions', () => {
    setup();
    expect(group('Body region').getByRole('button', { name: /^Knee/ })).toHaveTextContent('3');
  });

  it('search finds "slr" by alternative name and an empty region offers the others', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search exercises' }), 'slr');
    expect(screen.getByText('Straight Leg Raise')).toBeInTheDocument();
    expect(screen.queryByText('Quad Sets')).toBeNull();
    expect(group('Body region').getByRole('button', { name: /^Face/ })).toBeDisabled();
    await user.clear(screen.getByRole('searchbox'));
    await user.click(group('Body region').getByRole('button', { name: /^Face/ }));
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(screen.getByText(/No matches in Face/)).toBeInTheDocument();
  });

  it('Equipment and Type combine', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText(/^Equipment/));
    await user.click(screen.getByLabelText(/^Towel/));
    await user.click(group('Type').getByRole('button', { name: /^Activation/ }));
    const active = screen.getByLabelText('Active filters');
    expect(within(active).getByRole('button', { name: 'Activation ✕' })).toBeInTheDocument();
    expect(within(active).getByText('1 exercise')).toBeInTheDocument();
    expect(screen.queryByText('Glute Bridge')).toBeNull();
  });

  it('sorts by Most used (default), A-Z and Recently added', async () => {
    const user = userEvent.setup();
    const { container } = setup({ useCounts: { '7': 5, '3': 2 }, exercises: [...LIB.slice(0, 3), ex('7', 'Straight Leg Raise', { bodyRegion: 'Hip', createdAt: '2026-01-01' })] });
    const order = () => [...container.querySelectorAll('[data-exercise]')].map((e) => e.getAttribute('data-exercise'));
    expect(order()).toEqual(['7', '3', '2', '1']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'az');
    expect(order()).toEqual(['3', '2', '1', '7'].sort((a, b) => ({ '3': 'Banded', '2': 'Hamstring', '1': 'Quad', '7': 'Straight' } as Record<string, string>)[a].localeCompare(({ '3': 'Banded', '2': 'Hamstring', '1': 'Quad', '7': 'Straight' } as Record<string, string>)[b])));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'recent');
    expect(order()[order().length - 1]).not.toBe('7');
  });

  it('Table view shows Position and Used columns, sorts by Type from the header, and is remembered', async () => {
    const user = userEvent.setup();
    const { unmount, container } = setup({ useCounts: { '1': 3 } });
    await user.click(screen.getByRole('button', { name: 'Table' }));
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual(expect.arrayContaining(['Position', 'Used']));
    expect(screen.getByText('3×')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Type' }));
    const order = [...container.querySelectorAll('tbody [data-exercise]')].map((e) => e.getAttribute('data-exercise'));
    // stretching (2) comes before activation? Order is mobility, stretching, activation, strengthening...
    expect(order.indexOf('2')).toBeLessThan(order.indexOf('1'));
    expect(order.indexOf('1')).toBeLessThan(order.indexOf('3'));
    unmount();
    setup();
    expect(screen.getByRole('button', { name: 'Table' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(0);
  });

  it('pelvic floor rows show a text tile (never a picture); others show their thumbnail', async () => {
    const { container } = setup();
    await vi.waitFor(() => expect(container.querySelectorAll('img').length).toBe(1));
    expect(container.innerHTML).not.toContain('e5/thumb');
    expect(container.innerHTML).not.toContain('e4/thumb');
  });

  it('a tap calls onActivate; in picker mode ticked ones show pressed and disabled ones show "In program"', async () => {
    const user = userEvent.setup();
    const { onActivate } = setup({ selected: new Set(['1']), disabledIds: new Set(['2']) });
    expect(screen.getByRole('button', { name: /Quad Sets/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Hamstring Stretch/ })).toBeDisabled();
    expect(screen.getByText('In program')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Banded Side Steps/ }));
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: '3' }));
  });

  it('a star on each card in Library mode', async () => {
    const user = userEvent.setup();
    const onToggleFavorite = vi.fn();
    setup({ onToggleFavorite });
    await user.click(screen.getByRole('button', { name: 'Remove Quad Sets from favourites' }));
    expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
  });

  it('shows the empty state when the clinic has no exercises', () => {
    setup({ exercises: [], emptyState: <p>Nothing yet</p> });
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
    void names;
  });
});
