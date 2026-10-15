// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

afterEach(cleanup);

describe('EmptyState', () => {
  it('says why it is empty and runs the chosen next step', () => {
    const onClick = vi.fn();
    render(<EmptyState title="No visits in this date range" hint="Widen the range." actions={[{ label: 'Show all time', onClick }]} />);
    expect(screen.getByText('No visits in this date range')).toBeInTheDocument();
    expect(screen.getByText('Widen the range.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show all time' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders no button row when there is nothing to offer', () => {
    render(<EmptyState title="No patients yet" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders extra controls after the actions', () => {
    render(<EmptyState title="t" actions={[{ label: 'A', onClick: vi.fn() }]}><a href="/new">New</a></EmptyState>);
    expect(screen.getByRole('link', { name: 'New' })).toBeInTheDocument();
  });
});
