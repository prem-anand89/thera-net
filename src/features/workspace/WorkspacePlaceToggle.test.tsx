// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { inWorkspacePlace, WorkspacePlaceToggle } from './WorkspacePlaceToggle';

describe('WorkspacePlaceToggle', () => {
  afterEach(cleanup);

  it('offers All, Clinic and Home visit and reports the choice', () => {
    const onChange = vi.fn();
    render(<WorkspacePlaceToggle clinic={{ careLocations: ['clinic', 'home'] }} value="" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Home visit' }));
    expect(onChange).toHaveBeenCalledWith('home');
  });

  it('renders nothing for a one-place clinic', () => {
    const { container } = render(<WorkspacePlaceToggle clinic={{ careLocations: ['clinic'] }} value="" onChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('inWorkspacePlace', () => {
  it('keeps everything for All, and reads a record with no place as Clinic', () => {
    expect(inWorkspacePlace('', { location: 'home' })).toBe(true);
    expect(inWorkspacePlace('clinic', {})).toBe(true);
    expect(inWorkspacePlace('clinic', { location: null })).toBe(true);
    expect(inWorkspacePlace('clinic', { location: 'home' })).toBe(false);
    expect(inWorkspacePlace('home', { location: 'home' })).toBe(true);
  });
});
