// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

let newFeedbackCount = 0;
let lowRatingCount = 0;
let newAppointmentCount = 0;
vi.mock('@/features/schedule/scheduleSignals', () => ({
  useNewFeedbackResponseCount: () => newFeedbackCount,
  useNewLowRatingFeedbackCount: () => lowRatingCount,
  useNewTherapistAppointmentCount: () => newAppointmentCount,
}));

import { NotificationBell } from './NotificationBell';

describe('NotificationBell', () => {
  afterEach(() => {
    cleanup();
    navigate.mockClear();
    newFeedbackCount = 0;
    lowRatingCount = 0;
    newAppointmentCount = 0;
  });

  it('shows no badge when there is nothing new', () => {
    render(<NotificationBell clinicId="c1" pendingRequestsCount={0} isAdmin />);
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAccessibleName('No new notifications');
  });

  it('badges the combined count and stays teal with only pending requests', () => {
    render(<NotificationBell clinicId="c1" pendingRequestsCount={3} isAdmin />);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('3');
    expect(button.className).toContain('text-[var(--muted)]');
    expect(button.className).not.toContain('text-[var(--rust)]');
  });

  it('turns red and names the low-rating response when one is unread', () => {
    newFeedbackCount = 2;
    lowRatingCount = 1;
    render(<NotificationBell clinicId="c1" pendingRequestsCount={1} isAdmin />);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('3');
    expect(button.className).toContain('text-[var(--rust)]');
    expect(button).toHaveAccessibleName('1 new booking request, 2 new feedback responses · 1 low-rated');
  });

  it('opens a dropdown row for each unread category and routes to its tab', () => {
    newFeedbackCount = 1;
    newAppointmentCount = 0;
    render(<NotificationBell clinicId="c1" pendingRequestsCount={2} isAdmin />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('menuitem', { name: /2 new booking requests/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /1 new feedback response/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: /2 new booking requests/ }));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/schedule', search: { tab: 'bookings', view: 'requests' } });
    fireEvent.click(screen.getByRole('button'));
    fireEvent.click(screen.getByRole('menuitem', { name: /new feedback response/ }));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/schedule', search: { tab: 'feedback' } });
  });

  it('says so in the dropdown when nothing is new', () => {
    render(<NotificationBell clinicId="c1" pendingRequestsCount={0} isAdmin />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('No new notifications.')).toBeInTheDocument();
  });

  it('badges a therapist viewer with their own new/changed appointment count', () => {
    newAppointmentCount = 2;
    render(
      <NotificationBell clinicId="c1" pendingRequestsCount={0} isAdmin={false} therapistId="th-1" />
    );
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('2');
    expect(button.className).toContain('text-[var(--muted)]');
    expect(button).toHaveAccessibleName('2 new or updated appointments');

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('menuitem', { name: /new or updated appointment/ }));
    expect(navigate).toHaveBeenCalledWith({ to: '/schedule', search: { tab: 'bookings' } });
  });

  it('moves focus between items with arrow keys and closes on Escape', () => {
    newFeedbackCount = 1;
    render(<NotificationBell clinicId="c1" pendingRequestsCount={1} isAdmin />);
    const trigger = screen.getByRole('button');
    fireEvent.click(trigger);

    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBe(2);
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(items[1]).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('opens from the keyboard with ArrowDown on the bell', () => {
    newFeedbackCount = 1;
    render(<NotificationBell clinicId="c1" pendingRequestsCount={0} isAdmin />);
    fireEvent.keyDown(screen.getByRole('button'), { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem')).toHaveFocus();
  });
});
