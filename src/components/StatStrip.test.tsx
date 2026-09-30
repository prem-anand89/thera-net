// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { StatStrip } from './ui';

describe('StatStrip', () => {
  afterEach(cleanup);

  it('groups numbers under captions; only cells with a target are buttons', () => {
    const onVisits = vi.fn();
    render(
      <StatStrip
        groups={[
          { caption: 'Today', cells: [{ label: 'Collected', value: '₹4,500' }, { label: 'Visits', value: 6, onClick: onVisits }] },
          { caption: 'October', cells: [{ label: 'New packages', value: 3 }] },
        ]}
      />
    );
    const today = screen.getByRole('region', { name: 'Today' });
    expect(within(today).getByText('₹4,500')).toBeInTheDocument();
    expect(within(today).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(within(today).getByRole('button', { name: /Visits/ }));
    expect(onVisits).toHaveBeenCalled();
    expect(within(screen.getByRole('region', { name: 'October' })).getByText('3')).toBeInTheDocument();
  });
});
