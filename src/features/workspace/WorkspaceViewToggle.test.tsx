// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceViewToggle } from './WorkspaceViewToggle';

afterEach(cleanup);

describe('WorkspaceViewToggle', () => {
  it('marks the current view', () => {
    render(<WorkspaceViewToggle mineOnly={false} onChange={() => {}} />);
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Mine' })).toHaveAttribute('aria-selected', 'false');
  });

  it('reports the choice', () => {
    const onChange = vi.fn();
    render(<WorkspaceViewToggle mineOnly onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect(onChange).toHaveBeenLastCalledWith('all');
    fireEvent.click(screen.getByRole('tab', { name: 'Mine' }));
    expect(onChange).toHaveBeenLastCalledWith('mine');
  });
});
