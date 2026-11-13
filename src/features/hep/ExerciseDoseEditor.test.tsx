// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { DoseValue } from '@/domain/hepDose';
import { ExerciseDoseEditor, type ExerciseDoseEditorProps } from './ExerciseDoseEditor';

afterEach(cleanup);

const start: DoseValue = { kind: 'reps', sets: 3, reps: 10, holdSeconds: null, durationSeconds: null, restSeconds: 30, side: 'none', sessionsPerDay: null };

function Harness({ initial = start, ...rest }: { initial?: DoseValue } & Partial<ExerciseDoseEditorProps>) {
  const [v, setV] = useState(initial);
  return (
    <>
      <ExerciseDoseEditor value={v} onChange={setV} {...rest} />
      <output data-testid="value">{JSON.stringify(v)}</output>
    </>
  );
}
const current = () => JSON.parse(screen.getByTestId('value').textContent ?? '{}') as DoseValue;
const chipsIn = (group: string) => within(screen.getByRole('group', { name: group })).getAllByRole('button').map((b) => b.textContent);

describe('ExerciseDoseEditor', () => {
  it('renders the same chips everywhere (Sets 1 2 3; Reps 5 8 10 12 15; Rest 0 15 30 60 s) and Other', () => {
    render(<Harness />);
    expect(chipsIn('Sets')).toEqual(['1', '2', '3', 'Other']);
    expect(chipsIn('Reps')).toEqual(['5', '8', '10', '12', '15', 'Other']);
    expect(chipsIn('Rest between sets')).toEqual(['0 s', '15 s', '30 s', '60 s', 'Other']);
  });

  it('Reps with a hold adds Hold each rep (5 10 30 s); Timed swaps Reps for Time (15 30 45 60 s)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByRole('group', { name: 'Hold each rep' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Reps with a hold' }));
    expect(chipsIn('Hold each rep')).toEqual(['5 s', '10 s', '30 s', 'Other']);
    expect(current()).toMatchObject({ kind: 'hold', reps: 10, holdSeconds: 10 });
    await user.click(screen.getByRole('button', { name: 'Timed' }));
    expect(screen.queryByRole('group', { name: 'Reps' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Hold each rep' })).toBeNull();
    expect(chipsIn('Time')).toEqual(['15 s', '30 s', '45 s', '60 s', 'Other']);
    expect(current()).toMatchObject({ kind: 'timed', reps: null, holdSeconds: null, durationSeconds: 30 });
  });

  it('Other accepts any whole number and keeps it inside the limit', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(within(screen.getByRole('group', { name: 'Reps' })).getByRole('button', { name: 'Other' }));
    const input = screen.getByRole('spinbutton', { name: 'Reps, other' });
    await user.clear(input);
    await user.type(input, '25');
    expect(current().reps).toBe(25);
    await user.clear(input);
    await user.type(input, '9999');
    expect(current().reps).toBe(600);
  });

  it('a value that is not a chip shows its own number in the Other box', () => {
    render(<Harness initial={{ ...start, reps: 20 }} />);
    expect(screen.getByRole('spinbutton', { name: 'Reps, other' })).toHaveValue(20);
  });

  it('Times a day offers "Same as the program (N)" only when a program is given', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    expect(chipsIn('Times a day')).toEqual(['1', '2', '3']);
    unmount();
    render(<Harness programSessionsPerDay={2} />);
    expect(chipsIn('Times a day')).toEqual(['Same as the program (2)', '1', '2', '3']);
    await user.click(within(screen.getByRole('group', { name: 'Times a day' })).getByRole('button', { name: '3' }));
    expect(current().sessionsPerDay).toBe(3);
    await user.click(screen.getByRole('button', { name: 'Same as the program (2)' }));
    expect(current().sessionsPerDay).toBeNull();
  });

  it('Progress chips add 1 set, 2 reps, 5 s hold or 15 s by kind; absent unless asked for', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    expect(screen.queryByText('Progress')).toBeNull();
    unmount();
    render(<Harness showProgress />);
    await user.click(screen.getByRole('button', { name: '+1 set' }));
    await user.click(screen.getByRole('button', { name: '+2 reps' }));
    expect(current()).toMatchObject({ sets: 4, reps: 12 });
  });

  it('shows the Optional switch only where asked and only when the value carries it', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness showOptional />);
    expect(screen.queryByLabelText(/Optional/)).toBeNull();
    unmount();
    render(<Harness showOptional initial={{ ...start, optional: false }} />);
    await user.click(screen.getByLabelText(/Optional/));
    expect(current().optional).toBe(true);
  });

  it('Side lists the four wordings', () => {
    render(<Harness />);
    const options = within(screen.getByLabelText('Side')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual(['Not side-specific', 'Left side only', 'Right side only', 'Each side']);
  });
});
