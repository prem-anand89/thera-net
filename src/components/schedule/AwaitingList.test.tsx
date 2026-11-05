// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AppointmentRequest } from '@/domain/types';
import { AwaitingList } from './AwaitingList';

afterEach(cleanup);

const req = (id: string, over: Partial<AppointmentRequest> = {}): AppointmentRequest =>
  ({
    id,
    clinicId: 'c1',
    name: id,
    phone: '9820000002',
    email: null,
    preferredTherapistId: null,
    notes: null,
    preferredDate: null,
    preferredTimeText: null,
    status: 'pending',
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '',
    ...over,
  }) as AppointmentRequest;

function setup(requests: AppointmentRequest[], limit = 3) {
  const fns = { onBook: vi.fn(), onMessage: vi.fn(), onDismiss: vi.fn(), onSeeAll: vi.fn() };
  render(<AwaitingList requests={requests} today="2026-11-05" limit={limit} therapistNameFor={(id) => (id ? 'Prem Anand' : null)} {...fns} />);
  return fns;
}

describe('AwaitingList', () => {
  it('shows who, how long ago, the phone, when and with whom, and the reason, with nothing truncated', () => {
    setup([req('Meera', { preferredDate: '2026-11-06', preferredTimeOfDay: 'morning', preferredTherapistId: 't1', notes: 'Right shoulder pain' })]);
    const when = screen.getByText(/Fri, 6 Nov, morning/).parentElement!;
    expect(when).toHaveTextContent('with Prem Anand');
    expect(when).toHaveTextContent('Right shoulder pain');
    expect(when.className).not.toContain('truncate');
    expect(screen.getByRole('link', { name: '9820000002' })).toHaveAttribute('href', 'tel:9820000002');
  });

  it('tags a request from the booking page "Online", and not a staff entry', () => {
    setup([req('web', { source: 'online' }), req('desk', { source: 'staff' }), req('old')]);
    expect(screen.getAllByText('Online')).toHaveLength(1);
  });

  it('Book, WhatsApp and Dismiss each act on their own row', () => {
    const f = setup([req('a', { createdAt: '2026-11-01T10:00:00Z' }), req('b', { createdAt: '2026-11-02T10:00:00Z' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Book b' }));
    fireEvent.click(screen.getByRole('button', { name: 'WhatsApp a' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss a' }));
    expect(f.onBook).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
    expect(f.onMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    expect(f.onDismiss).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('puts a past entry last, marked "Was for 3 Nov", and still lets it be booked', () => {
    const f = setup([req('old', { createdAt: '2026-10-01T10:00:00Z', preferredDate: '2026-11-03' }), req('fresh', { createdAt: '2026-11-04T10:00:00Z' })]);
    const names = screen.getAllByRole('button', { name: /^Book / }).map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Book fresh', 'Book old']);
    expect(screen.getByText('Was for 3 Nov')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Book old' }));
    expect(f.onBook).toHaveBeenCalledTimes(1);
  });

  it('caps the list and counts the rest', () => {
    const f = setup([1, 2, 3, 4].map((i) => req(`p${i}`, { createdAt: `2026-11-0${i}T10:00:00Z` })));
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('button', { name: /^Book / })).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'See all 4 awaiting' }));
    expect(f.onSeeAll).toHaveBeenCalled();
  });
});
