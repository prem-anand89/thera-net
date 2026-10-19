// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ScheduleMenu, type ScheduleMenuItem } from './ScheduleMenu';

function items(onSelect = vi.fn()): ScheduleMenuItem[] {
  return [
    { id: 'find', label: 'Find a time', hint: 'See free start times for each therapist', icon: 'find', group: 'view', onSelect },
    { id: 'cancelled', label: 'Show cancelled', icon: 'cancelled', group: 'view', onSelect },
    { id: 'waitlist', label: 'Add to waitlist', icon: 'waitlist', group: 'actions', onSelect },
    { id: 'closed', label: 'Set closed days', icon: 'closed', group: 'manage', onSelect },
    { id: 'keys', label: 'Keyboard shortcuts', icon: 'keys', group: 'view', desktopOnly: true, onSelect },
  ];
}

describe('ScheduleMenu on phones', () => {
  afterEach(cleanup);

  it('opens a bottom sheet with grouped rows and hints, without desktop-only items', () => {
    render(<ScheduleMenu items={items()} isPhone />);
    expect(screen.queryByText('Schedule options')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'More schedule options' }));
    expect(screen.getByText('Schedule options')).toBeInTheDocument();
    const view = screen.getByRole('region', { name: 'View' });
    expect(within(view).getByRole('button', { name: /Find a time/ })).toBeInTheDocument();
    expect(within(view).getByText('See free start times for each therapist')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Do' })).getByRole('button', { name: /Add to waitlist/ })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Manage' })).getByRole('button', { name: /Set closed days/ })).toBeInTheDocument();
    expect(screen.queryByText('Keyboard shortcuts')).not.toBeInTheDocument();
  });

  it('closes the sheet and runs the action when a row is tapped', () => {
    const onSelect = vi.fn();
    render(<ScheduleMenu items={items(onSelect)} isPhone />);
    fireEvent.click(screen.getByRole('button', { name: 'More schedule options' }));
    fireEvent.click(screen.getByRole('button', { name: /Set closed days/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Schedule options')).not.toBeInTheDocument();
  });

  it('omits a group with no items (a therapist has no Manage group)', () => {
    render(<ScheduleMenu items={items().filter((i) => i.group === 'view' && !i.desktopOnly)} isPhone />);
    fireEvent.click(screen.getByRole('button', { name: 'More schedule options' }));
    expect(screen.queryByRole('region', { name: 'Manage' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Do' })).not.toBeInTheDocument();
  });
});

describe('ScheduleMenu on tablet and desktop', () => {
  afterEach(cleanup);

  it('keeps a popover with all groups (including keyboard shortcuts) and runs the action', () => {
    const onSelect = vi.fn();
    render(<ScheduleMenu items={items(onSelect)} isPhone={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'More schedule options' }));
    expect(screen.queryByText('Schedule options')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Keyboard shortcuts/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add to waitlist/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
