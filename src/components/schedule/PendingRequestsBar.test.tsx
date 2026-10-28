// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppointmentRequest } from '@/domain/types';
import { PendingRequestsBar, mostUrgentRequest } from './PendingRequestsBar';

const request = (over: Partial<AppointmentRequest>): AppointmentRequest => ({
  id: 'r1', clinicId: 'c', name: 'John Doe', phone: '9032323890', email: null, preferredTherapistId: 't1',
  notes: null, preferredDate: '2026-10-30', preferredTimeText: '10:00 AM', status: 'pending',
  appointmentId: null, createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(), updatedAt: '', ...over,
});

describe('mostUrgentRequest', () => {
  it('picks the one wanted soonest, then the one waiting longest, and puts "any day" last', () => {
    const later = request({ id: 'later', preferredDate: '2026-11-05' });
    const sooner = request({ id: 'sooner', preferredDate: '2026-10-30', createdAt: '2026-10-29T10:00:00Z' });
    const soonerOlder = request({ id: 'sooner-older', preferredDate: '2026-10-30', createdAt: '2026-10-28T10:00:00Z' });
    const anyDay = request({ id: 'any', preferredDate: null });
    expect(mostUrgentRequest([later, anyDay, sooner, soonerOlder])?.id).toBe('sooner-older');
    expect(mostUrgentRequest([later, anyDay])?.id).toBe('later');
    expect(mostUrgentRequest([])).toBeNull();
  });
});

describe('PendingRequestsBar', () => {
  afterEach(cleanup);
  const setup = (requests: AppointmentRequest[]) => {
    const handlers = { onConfirm: vi.fn(), onDecline: vi.fn(), onFocus: vi.fn(), onSeeAll: vi.fn() };
    render(<PendingRequestsBar requests={requests} therapistNameFor={() => 'Prem Anand'} {...handlers} />);
    return handlers;
  };

  it('shows the request whatever day is on screen, with the day, time and therapist, and answers it in place', () => {
    const h = setup([request({})]);
    expect(screen.getByRole('region', { name: 'Booking request to confirm' })).toHaveTextContent('John Doe asked for Fri, 30 Oct, 10:00 AM · Prem Anand');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.click(screen.getByRole('button', { name: 'Show on calendar' }));
    expect(h.onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    expect(h.onDecline).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    expect(h.onFocus).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
  });

  it('says how many others wait and opens the full list', () => {
    const h = setup([request({}), request({ id: 'r2', name: 'Meera' }), request({ id: 'r3', name: 'Kiran' })]);
    fireEvent.click(screen.getByRole('button', { name: '+2 more' }));
    expect(h.onSeeAll).toHaveBeenCalled();
  });

  it('renders nothing when no request waits', () => {
    const { container } = render(<PendingRequestsBar requests={[]} therapistNameFor={() => null} onConfirm={vi.fn()} onDecline={vi.fn()} onFocus={vi.fn()} onSeeAll={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
