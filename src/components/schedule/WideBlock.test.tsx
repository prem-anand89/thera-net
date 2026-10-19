// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WideBlock } from './WideBlock';

const flags = [
  { key: 'new' as const, label: 'New patient' },
  { key: 'package' as const, label: 'Package 3/6' },
];
const base = { name: 'Priya Sharma', start: 10 * 60, end: 11 * 60, reason: 'Shoulder pain', flags };

describe('WideBlock', () => {
  afterEach(cleanup);

  it('is one line "10:00 Name" when very short', () => {
    render(<WideBlock {...base} end={10 * 60 + 15} height={20} />);
    expect(screen.getByText(/Priya Sharma/)).toBeInTheDocument();
    expect(screen.queryByText('Shoulder pain')).not.toBeInTheDocument();
    expect(screen.queryByText('New patient')).not.toBeInTheDocument();
  });

  it('is two lines at 40px: name with the time range, then the reason (no flags)', () => {
    render(<WideBlock {...base} end={10 * 60 + 30} height={40} />);
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
    expect(screen.getByText('10:00–10:30')).toBeInTheDocument();
    expect(screen.getByText('Shoulder pain')).toBeInTheDocument();
    expect(screen.queryByText('New patient')).not.toBeInTheDocument();
  });

  it('is three lines from 52px: name and time, reason, then up to two flags', () => {
    render(<WideBlock {...base} height={80} />);
    expect(screen.getByText('Shoulder pain')).toBeInTheDocument();
    expect(screen.getByText('New patient')).toBeInTheDocument();
    expect(screen.getByText('Package 3/6')).toBeInTheDocument();
  });

  it('puts the flags on the second line when there is no reason, and hides them at two lines only if none', () => {
    render(<WideBlock {...base} reason={null} height={40} />);
    expect(screen.getByText('New patient')).toBeInTheDocument();
    cleanup();
    render(<WideBlock {...base} reason={null} flags={[]} height={40} />);
    expect(screen.queryByText('New patient')).not.toBeInTheDocument();
  });

  it('shows the status mark before the name', () => {
    render(<WideBlock {...base} height={40} mark="✓" />);
    expect(screen.getByText('✓', { exact: false })).toBeInTheDocument();
  });
});
