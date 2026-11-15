// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { ClinicContext } from '@/app/clinicContext';
import type { Clinic } from '@/domain/types';
import type { Exercise } from '@/domain/hep';
import type { HepItemInput } from '@/services/hepService';
import { ProgramItemsEditor, type ProgramItemsEditorProps } from './ProgramItemsEditor';
import { exerciseToItem } from './hepItems';

vi.mock('@/services/hepMediaService', () => ({ hepMediaService: { mintViewUrls: async (_c: string, keys: string[]) => Object.fromEntries(keys.map((k) => [k, `https://img/${k}`])) } }));

const clinic = { id: 'c1', name: 'Sunrise', timezone: 'UTC' } as unknown as Clinic;
const ex = (id: string, title: string, over: Partial<Exercise> = {}): Exercise => ({
  id, clinicId: 'c1', title, positions: [], otherNames: [], bodyRegion: 'Knee', alsoRegions: [], equipment: [], phase: 'strengthening', instructions: '', mediaType: 'none', mediaKeys: [], mediaCaptions: [], thumbKey: null,
  defaultSets: 3, doseType: 'reps', defaultReps: 10, defaultHoldSeconds: null, defaultDurationSeconds: null, defaultRestSeconds: 30, defaultSessionsPerDay: 1, side: 'none', stopIf: '', isFavorite: false, active: true, deleted: false, version: 1, createdAt: '', updatedAt: '', ...over,
});

const squat = ex('a', 'Squat');
const quad = ex('q', 'Quad Sets', { phase: 'activation' });
const bridge = ex('b', 'Bridge');
const kegel = ex('k', 'Pelvic floor squeeze', { bodyRegion: 'Pelvic floor', phase: 'activation', thumbKey: 'k.jpg' });
const library = [squat, quad, bridge, kegel, { ...ex('m', 'Marching'), phase: 'mobility' as const }];

let saved: HepItemInput[] = [];
function Harness({ start, ...rest }: { start: HepItemInput[] } & Partial<ProgramItemsEditorProps>) {
  const [items, setItems] = useState(start);
  return (
    <ClinicContext.Provider value={clinic}>
      <ProgramItemsEditor items={items} setItems={(next) => { saved = next; setItems(next); }} sessionsPerDay={1} library={library} onAdd={() => {}} {...rest} />
    </ClinicContext.Provider>
  );
}
const item = (e: Exercise, over: Partial<HepItemInput> = {}): HepItemInput => ({ ...exerciseToItem(e), ...over });
const openMenu = async (user: ReturnType<typeof userEvent.setup>, title: string) => user.click(screen.getByRole('button', { name: `More for ${title}` }));
const menuNames = () => screen.getAllByRole('button').filter((b) => b.closest('[data-row-menu]')).map((b) => b.textContent);

afterEach(() => { cleanup(); saved = []; });

describe('ProgramItemsEditor: the three blocks', () => {
  it('shows Warm-up, Main exercises · n grouped by type in session order, and Cool-down', () => {
    render(<Harness start={[item(squat), item(quad), item(ex('w', 'Ankle pumps'), { phase: 'warm_up' })]} />);
    expect(within(screen.getByRole('region', { name: 'Warm-up' })).getByText('Ankle pumps')).toBeInTheDocument();
    const main = screen.getByRole('region', { name: 'Main exercises' });
    expect(within(main).getByText('Main exercises')).toBeInTheDocument();
    expect(within(main).getByText('· 2')).toBeInTheDocument();
    expect(within(main).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['Activation', 'Strengthening']);
    expect(screen.getByRole('region', { name: 'Cool-down' })).toBeInTheDocument();
  });

  it('an empty warm-up offers "+ Add a warm-up"; with rows it reads "+ Add to warm-up"', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const { unmount } = render(<Harness start={[item(squat)]} onAdd={onAdd} />);
    await user.click(screen.getByRole('button', { name: /^\+ Add a warm-up/ }));
    expect(onAdd).toHaveBeenCalledWith('warm_up');
    expect(screen.getByRole('button', { name: /^\+ Add a warm-up/ })).toHaveTextContent('Done first, before the main exercises');
    await user.click(screen.getByRole('button', { name: /^\+ Add a cool-down/ }));
    expect(onAdd).toHaveBeenCalledWith('cool_down');
    expect(screen.getByRole('button', { name: /^\+ Add a cool-down/ })).toHaveTextContent('Done last, after the main exercises');
    await user.click(screen.getByRole('button', { name: '+ Add exercises' }));
    expect(onAdd).toHaveBeenCalledWith('main');
    unmount();
    render(<Harness start={[item(squat), item(bridge, { phase: 'warm_up' })]} />);
    expect(screen.getByRole('button', { name: /^\+ Add to warm-up/ })).toBeInTheDocument();
  });
});

describe('ProgramItemsEditor: the ⋯ menu', () => {
  it('a main row offers Move to warm-up / Move to cool-down, Move up / Move down; moving to the cool-down puts it there', async () => {
    const user = userEvent.setup();
    render(<Harness start={[item(squat), item(bridge)]} />);
    await openMenu(user, 'Squat');
    expect(menuNames()).toEqual(['Move to warm-up', 'Move to cool-down', 'Move up', 'Move down']);
    expect(screen.getByRole('button', { name: 'Move up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move down' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Move to cool-down' }));
    expect(within(screen.getByRole('region', { name: 'Cool-down' })).getByText('Squat')).toBeInTheDocument();
    expect(saved.map((i) => [i.title, i.phase])).toEqual([['Bridge', 'strengthening'], ['Squat', 'cool_down']]);
  });

  it('a warm-up row offers only "Move to main exercises", which restores the source exercise\'s type', async () => {
    const user = userEvent.setup();
    render(<Harness start={[item(quad, { phase: 'warm_up' }), item(ex('gone', 'Deleted one'), { phase: 'cool_down' })]} />);
    await openMenu(user, 'Quad Sets');
    expect(menuNames()).toEqual(['Move to main exercises', 'Move up', 'Move down']);
    await user.click(screen.getByRole('button', { name: 'Move to main exercises' }));
    expect(within(screen.getByRole('region', { name: 'Activation' })).getByText('Quad Sets')).toBeInTheDocument();
    await openMenu(user, 'Deleted one');
    await user.click(screen.getByRole('button', { name: 'Move to main exercises' }));
    expect(within(screen.getByRole('region', { name: 'Other' })).getByText('Deleted one')).toBeInTheDocument();
  });

  it('Move down swaps within the section, and ✕ removes the row', async () => {
    const user = userEvent.setup();
    render(<Harness start={[item(squat), item(bridge), item(quad)]} />);
    await openMenu(user, 'Squat');
    await user.click(screen.getByRole('button', { name: 'Move down' }));
    expect(saved.map((i) => i.title)).toEqual(['Bridge', 'Squat', 'Quad Sets']);
    await user.click(screen.getByRole('button', { name: 'Remove Quad Sets' }));
    expect(saved.map((i) => i.title)).toEqual(['Bridge', 'Squat']);
  });

  it('"Optional" on a type section marks only that section', async () => {
    const user = userEvent.setup();
    render(<Harness start={[item(squat), item(quad)]} />);
    await user.click(within(screen.getByRole('region', { name: 'Activation' })).getByRole('checkbox', { name: /Optional/ }));
    expect(saved.map((i) => [i.title, i.optional])).toEqual([['Squat', false], ['Quad Sets', true]]);
  });
});

describe('ProgramItemsEditor: rows', () => {
  it('tapping a row opens its dosage and the note to patient; pelvic floor rows never get a picture', async () => {
    const user = userEvent.setup();
    render(<Harness start={[item(squat, { mediaKeys: [] }), item(kegel)]} library={[{ ...squat, thumbKey: 's.jpg' }, kegel]} />);
    await user.click(screen.getByRole('button', { name: /^Squat/ }));
    expect(screen.getByLabelText('Note to patient (optional, any language)')).toBeInTheDocument();
    const kegelRow = screen.getByRole('button', { name: /^Pelvic floor squeeze/ }).closest('li') as HTMLElement;
    expect(kegelRow.querySelector('img')).toBeNull();
    const squatRow = screen.getByRole('button', { name: /^Squat/ }).closest('li') as HTMLElement;
    await vi.waitFor(() => expect(squatRow.querySelector('img')).not.toBeNull());
  });

  it('the template editor has no note to patient', async () => {
    const user = userEvent.setup();
    render(<Harness start={[item(squat)]} forTemplate />);
    await user.click(screen.getByRole('button', { name: /^Squat/ }));
    expect(screen.queryByLabelText('Note to patient (optional, any language)')).toBeNull();
    expect(screen.getByRole('group', { name: 'Sets' })).toBeInTheDocument();
  });
});

describe('ProgramItemsEditor: empty', () => {
  it('offers three quick starts; "Repeat an earlier program" only when there is one', async () => {
    const user = userEvent.setup();
    const onQuickStart = vi.fn();
    const { unmount } = render(<Harness start={[]} onQuickStart={onQuickStart} canRepeatEarlier />);
    await user.click(screen.getByRole('button', { name: 'Add exercises' }));
    await user.click(screen.getByRole('button', { name: 'Start from a template' }));
    await user.click(screen.getByRole('button', { name: 'Repeat an earlier program' }));
    expect(onQuickStart.mock.calls.map((c) => c[0])).toEqual(['exercises', 'templates', 'earlier']);
    unmount();
    render(<Harness start={[]} onQuickStart={onQuickStart} />);
    expect(screen.queryByRole('button', { name: 'Repeat an earlier program' })).toBeNull();
  });
});
