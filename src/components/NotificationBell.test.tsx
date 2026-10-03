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
    expect(button).toHaveAccessibleName('1 new booking request, 2 new feedback responses');
  });

  it('routes to the feedback tab when unread feedback exists, bookings otherwise', () => {
    const { rerender } = render(<NotificationBell clinicId="c1" pendingRequestsCount={2} isAdmin />);
    fireEvent.click(screen.getByRole('button'));
    expect(navigate).toHaveBeenCalledWith({ to: '/schedule', search: { tab: 'bookings' } });

    newFeedbackCount = 1;
    navigate.mockClear();
    rerender(<NotificationBell clinicId="c1" pendingRequestsCount={2} isAdmin />);
    fireEvent.click(screen.getByRole('button'));
    expect(navigate).toHaveBeenCalledWith({ to: '/schedule', search: { tab: 'feedback' } });
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
    expect(navigate).toHaveBeenCalledWith({ to: '/schedule', search: { tab: 'bookings' } });
  });
});
