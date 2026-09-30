// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AppointmentRequest } from '@/domain/types';
import { RequestsInbox } from './RequestsInbox';

const request = (over: Partial<AppointmentRequest>): AppointmentRequest => ({
  id: 'r1', clinicId: 'c', name: 'Meera', phone: '9820000002', email: null, preferredTherapistId: null,
  notes: null, preferredDate: '2026-10-02', preferredTimeText: '10:30 AM', status: 'pending',
  appointmentId: null, createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(), updatedAt: '', ...over,
});

describe('RequestsInbox', () => {
  afterEach(cleanup);

  it('renders nothing when there are no requests', () => {
    const { container } = render(
      <RequestsInbox variant="strip" requests={[]} therapistNameFor={() => null} onConfirm={vi.fn()} onDecline={vi.fn()} onSeeAll={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('strip: collapsed summary, expands to rows with actions', () => {
    const onConfirm = vi.fn();
    const onDecline = vi.fn();
    render(
      <RequestsInbox
        variant="strip"
        requests={[request({}), request({ id: 'r2', name: 'Kiran', preferredTherapistId: 't1' })]}
        therapistNameFor={(id) => (id === 't1' ? 'Dr Asha' : null)}
        onConfirm={onConfirm}
        onDecline={onDecline}
        onSeeAll={vi.fn()}
      />
    );
    expect(screen.getByText('2 booking requests waiting')).toBeInTheDocument();
    expect(screen.getByText(/oldest 2h ago/)).toBeInTheDocument();
    expect(screen.queryByText('Meera')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Review/ }));
    expect(screen.getByText(/Wants Fri, 2 Oct, 10:30 AM · Dr Asha/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Decline' })[1]);
    expect(onDecline).toHaveBeenCalledWith(expect.objectContaining({ id: 'r2' }));
  });

  it('rail: shows a limited list and a See all link', () => {
    const onSeeAll = vi.fn();
    render(
      <RequestsInbox
        variant="rail"
        limit={1}
        requests={[request({}), request({ id: 'r2', name: 'Kiran' })]}
        therapistNameFor={() => null}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
        onSeeAll={onSeeAll}
      />
    );
    expect(screen.getByText('Meera', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/Kiran/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'See all 2 requests' }));
    expect(onSeeAll).toHaveBeenCalled();
  });
});
