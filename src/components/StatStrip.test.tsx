// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StatStrip } from './ui';

describe('StatStrip', () => {
  afterEach(cleanup);

  it('shows each number with its label; only cells with a target are buttons', () => {
    const onDues = vi.fn();
    render(
      <StatStrip
        cells={[
          { label: 'Collected', value: '₹4,500', kind: 'money' },
          { label: 'Dues · 3', value: '₹8,200', kind: 'money', onClick: onDues },
        ]}
      />
    );
    expect(screen.getByText('₹4,500')).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Dues/ }));
    expect(onDues).toHaveBeenCalled();
  });
});
