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
    expect(screen.getByText('2 booking requests')).toBeInTheDocument();
    expect(screen.getByText(/oldest 2h ago/)).toBeInTheDocument();
    expect(screen.queryByText('Meera')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Review/ }));
    expect(screen.getByText(/Fri, 2 Oct, 10:30 AM · Dr Asha/)).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]);
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Decline' })[1]);
    expect(onDecline).toHaveBeenCalledWith(expect.objectContaining({ id: 'r2' }));
  });

  it('rows: shows the full day, time and therapist without truncating, plus the reason and the phone', () => {
    render(
      <RequestsInbox
        variant="rows"
        requests={[request({ notes: 'Right shoulder pain for 2 weeks', preferredTherapistId: 't1' })]}
        therapistNameFor={() => 'Prem Anand'}
        onConfirm={vi.fn()}
        onDecline={vi.fn()}
        onSeeAll={vi.fn()}
      />
    );
    const when = screen.getByText(/Fri, 2 Oct, 10:30 AM, with Prem Anand/);
    expect(when.className).not.toContain('truncate');
    expect(screen.getByText('Right shoulder pain for 2 weeks')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '9820000002' })).toHaveAttribute('href', 'tel:9820000002');
  });

  it('rail: the name and time are the jump button; Confirm, Decline and the phone link stay separate, and nothing truncates', () => {
    const onFocus = vi.fn();
    const onConfirm = vi.fn();
    render(
      <RequestsInbox
        variant="rail"
        requests={[request({ notes: 'ACL rehab' })]}
        therapistNameFor={() => 'Prem Anand'}
        onConfirm={onConfirm}
        onDecline={vi.fn()}
        onSeeAll={vi.fn()}
        onFocus={onFocus}
      />
    );
    const jump = screen.getByRole('button', { name: /Meera/ });
    expect(jump).toHaveTextContent('Fri, 2 Oct, 10:30 AM · Prem Anand');
    expect(jump.querySelector('.truncate')).toBeNull();
    expect(jump.contains(screen.getByRole('link', { name: '9820000002' }))).toBe(false);
    expect(jump.contains(screen.getByRole('button', { name: 'Confirm' }))).toBe(false);
    expect(screen.getByText('ACL rehab')).toBeInTheDocument();
    fireEvent.click(jump);
    expect(onFocus).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }));
    expect(onConfirm).not.toHaveBeenCalled();
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
