// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Segmented } from './ui';

afterEach(cleanup);

const options = (pending: number) =>
  [
    { value: 'members', label: 'Team members' },
    { value: 'shifts', label: 'Shifts & coverage', badge: pending },
  ] as const;

describe('Segmented', () => {
  it('shows a count beside an option with pending items, and nothing at zero', () => {
    const { rerender } = render(<Segmented label="Team view" options={options(3)} value="members" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /^Shifts & coverage\s*\(3 pending\)$/ })).toBeInTheDocument();
    rerender(<Segmented label="Team view" options={options(0)} value="members" onChange={vi.fn()} />);
    expect(screen.getByRole('radio', { name: 'Shifts & coverage' })).toBeInTheDocument();
  });

  it('switches view on tap', () => {
    const onChange = vi.fn();
    render(<Segmented label="Team view" options={options(0)} value="members" onChange={onChange} />);
    fireEvent.click(screen.getByRole('radio', { name: /Shifts & coverage/ }));
    expect(onChange).toHaveBeenCalledWith('shifts');
  });
});
