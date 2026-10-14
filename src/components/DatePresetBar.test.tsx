// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DatePresetBar, DATE_PRESETS } from './DatePresetBar';

afterEach(cleanup);

describe('DatePresetBar', () => {
  it('renders all 5 default presets with the expected labels', () => {
    expect(DATE_PRESETS).toHaveLength(5);
    const onChange = vi.fn();
    render(<DatePresetBar value="week" onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'This week' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'This month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Last month' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All time' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument();
  });

  it('calls onChange when a preset button is clicked', () => {
    const onChange = vi.fn();
    render(<DatePresetBar value="week" onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'This month' }));
    expect(onChange).toHaveBeenCalledWith('month');
  });

  it('marks active preset with active styling', () => {
    const onChange = vi.fn();
    render(<DatePresetBar value="month" onChange={onChange} />);

    const monthBtn = screen.getByRole('button', { name: 'This month' });
    expect(monthBtn).toHaveClass('bg-[var(--teal)]');
    expect(monthBtn).toHaveClass('text-white');
  });
});

describe('DatePresetBar accessibility', () => {
  it('exposes the selected preset with aria-pressed', () => {
    render(<DatePresetBar value="month" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'This week' })).toHaveAttribute('aria-pressed', 'false');
  });
});
