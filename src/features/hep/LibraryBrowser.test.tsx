// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { Exercise } from '@/domain/hep';
import { LibraryBrowser } from './LibraryBrowser';

vi.mock('@/services/hepMediaService', () => ({
  hepMediaService: { mintViewUrls: async (_c: string, keys: string[]) => Object.fromEntries(keys.map((k) => [k, `https://img.test/${k}`])) },
}));
afterEach(cleanup);

const ex = (id: string, title: string, over: Partial<Exercise> = {}): Exercise => ({
  id, clinicId: 'c1', title, positions: [], otherNames: [], bodyRegion: 'Knee', alsoRegions: [], equipment: [], phase: 'strengthening', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [],
  thumbKey: null, defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'none', stopIf: '',
  isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '', ...over,
});

const LIB = [
  ex('1', 'Quad Sets', { phase: 'activation', equipment: ['Towel'], isFavorite: true, doseType: 'hold', defaultHoldSeconds: 10, defaultReps: 12 }),
  ex('2', 'Hamstring Stretch', { phase: 'stretching', alsoRegions: ['Hip'], equipment: ['Towel'] }),
  ex('3', 'Banded Side Steps', { bodyRegion: 'Hip', alsoRegions: ['Knee'], equipment: ['Theraband / resistance band'] }),
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
const rail = () => screen.getByRole('navigation', { name: 'Regions' });
const railNames = () => within(rail()).getAllByRole('button').map((b) => (b.textContent ?? '').replace(/^[▸▾]\s*/, ''));

describe('LibraryBrowser', () => {
  it('lists regions head to toe with counts, and opens a region to its types in session order', async () => {
    const user = userEvent.setup();
    setup();
    const names = railNames();
    expect(names.indexOf('Face1')).toBeGreaterThan(-1);
    expect(names.indexOf('Face1')).toBeLessThan(names.indexOf('Hip4'));
    expect(names.indexOf('Hip4')).toBeLessThan(names.indexOf('Knee3'));
    await user.click(within(rail()).getByRole('button', { name: /^Knee/ }));
    const types = railNames().filter((t) => /^(Stretching|Activation|Strengthening)/.test(t));
    expect(types).toEqual(['Stretching1', 'Activation1', 'Strengthening1']);
  });

  it('counts an exercise under its also-regions, and Pelvic floor opens to Women and Men', async () => {
    const user = userEvent.setup();
    setup();
    expect(within(rail()).getByRole('button', { name: /^Hip/ })).toHaveTextContent('4'); // Hamstring (also under Hip), Banded, Glute Bridge, Straight Leg Raise
    await user.click(within(rail()).getByRole('button', { name: /^Pelvic floor/ }));
    expect(within(rail()).getByRole('button', { name: /^Women/ })).toHaveTextContent('1');
    expect(within(rail()).getByRole('button', { name: /^Men/ })).toHaveTextContent('1');
  });

  it('search finds "slr" by other name and "hamstrig" with one typo; an empty region says so and offers the others', async () => {
    const user = userEvent.setup();
    setup();
    await user.type(screen.getByRole('searchbox', { name: 'Search exercises' }), 'slr');
    expect(screen.getByText('Straight Leg Raise')).toBeInTheDocument();
    expect(screen.queryByText('Quad Sets')).toBeNull();
    await user.clear(screen.getByRole('searchbox'));
    await user.type(screen.getByRole('searchbox'), 'hamstrig');
    expect(screen.getByText('Hamstring Stretch')).toBeInTheDocument();
    await user.click(within(rail()).getByRole('button', { name: /^Face/ }));
    expect(screen.getByText(/No matches in Face/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 in other regions' })).toBeInTheDocument();
  });

  it('Equipment and Type combine, with removable chips, Clear and the count', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByText(/^Equipment/));
    await user.click(screen.getByLabelText('Towel'));
    await user.click(screen.getByLabelText('Mat'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Type' }), 'activation');
    const active = screen.getByLabelText('Active filters');
    expect(within(active).getByRole('button', { name: 'Activation ✕' })).toBeInTheDocument();
    expect(within(active).getByRole('button', { name: 'Towel ✕' })).toBeInTheDocument();
    expect(within(active).getByText('1 exercise')).toBeInTheDocument();
    expect(screen.getByText('Quad Sets')).toBeInTheDocument();
    expect(screen.queryByText('Glute Bridge')).toBeNull();
    await user.click(within(active).getByRole('button', { name: 'Towel ✕' }));
    expect(within(screen.getByLabelText('Active filters')).queryByRole('button', { name: 'Towel ✕' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.queryByLabelText('Active filters')).toBeNull();
  });

  it('pelvic floor rows show a text tile (never a picture) in list and grid; others show their thumbnail', async () => {
    const user = userEvent.setup();
    const { container } = setup();
    // Cheek Puffs (Face) is the only one with a usable picture: Glute Bridge is also under Pelvic floor, so it is private too.
    await vi.waitFor(() => expect(container.querySelectorAll('img').length).toBe(1));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://img.test/clinics/c1/exercises/e6/thumb-cccccccc');
    expect(container.innerHTML).not.toContain('e5/thumb');
    expect(container.innerHTML).not.toContain('e4/thumb');
    await user.click(screen.getByRole('button', { name: /Grid/ }));
    expect(container.innerHTML).not.toContain('e5/thumb');
    expect(screen.getByText('Pelvic Floor Squeeze')).toBeInTheDocument();
  });

  it('shows Used this week above Favourites only when something was used', () => {
    const { unmount } = setup();
    expect(within(rail()).queryByRole('button', { name: /Used this week/ })).toBeNull();
    unmount();
    setup({ usedIds: new Set(['3']) });
    const names = railNames();
    expect(names[0]).toBe('Used this week1');
    expect(names[1]).toMatch(/Favourites/);
  });

  it('a tap calls onActivate; in picker mode ticked ones show pressed and disabled ones cannot be picked', async () => {
    const user = userEvent.setup();
    const { onActivate } = setup({ selected: new Set(['1']), disabledIds: new Set(['2']) });
    expect(screen.getByRole('button', { name: /Quad Sets/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Hamstring Stretch/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Banded Side Steps/ }));
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: '3' }));
  });

  it('a star on each row in Library mode', async () => {
    const user = userEvent.setup();
    const onToggleFavorite = vi.fn();
    setup({ onToggleFavorite });
    await user.click(screen.getByRole('button', { name: 'Remove Quad Sets from favourites' }));
    expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }));
  });

  it('shows the empty state when the clinic has no exercises', () => {
    setup({ exercises: [], emptyState: <p>Nothing yet</p> });
    expect(screen.getByText('Nothing yet')).toBeInTheDocument();
  });
});
