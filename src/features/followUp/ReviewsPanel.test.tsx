// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Appointment, Patient } from '@/domain/types';
import { toLocalDateStr, localDateTime } from '@/domain/schedule';

const { sendText, setFollowUp } = vi.hoisted(() => ({ sendText: vi.fn(), setFollowUp: vi.fn().mockResolvedValue({}) }));
vi.mock('@/services', () => ({ bookingService: { sendText }, patientService: { setFollowUp } }));
vi.mock('@/lib/notify', () => ({ notify: { error: vi.fn() } }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: { children: React.ReactNode; className?: string }) => <a className={className}>{children}</a>,
}));

import { ReviewsPanel } from './ReviewsPanel';

const today = toLocalDateStr(new Date());
const patient = (over: Partial<Patient>): Patient => ({
  id: 'p1', clinicId: 'c', mrno: '1', mrnoSource: 'hospital', name: 'Kavin P', age: null, sex: null, phone: '9820000002',
  primaryCondition: null, followUpOn: today, followUpSetOn: '2026-01-01', followUpTherapistId: 't1', followUpNote: 'reassess knee', updatedAt: '', ...over,
});
const noShow: Appointment = {
  id: 'a1', clinicId: 'c', patientId: 'p2', patientName: 'Meera', patientPhone: '9811111111', therapistId: 't1',
  scheduledAt: localDateTime(today, '10:00').toISOString(), status: 'no_show', requestId: null, visitId: null,
  rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '',
};

function setup(over: Partial<Parameters<typeof ReviewsPanel>[0]> = {}) {
  const onBook = vi.fn();
  render(
    <ReviewsPanel
      data={{
        due: [{ patient: patient({}), dueOn: today, daysFromDue: 0 }],
        missed: [{ patient: patient({ id: 'p3', name: 'Old One', followUpNote: null }), dueOn: '2026-10-01', daysFromDue: -20 }],
        noShows: [{ appointment: noShow, patient: patient({ id: 'p2', name: 'Meera', phone: '9811111111', followUpOn: null }) }],
      }}
      clinicName="BM Physio"
      canMessage
      therapistNameFor={(id) => (id === 't1' ? 'Dr Asha' : null)}
      onBook={onBook}
      {...over}
    />
  );
  return { onBook };
}

describe('ReviewsPanel', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('opens on Due with counts on every filter', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Due (1)' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Missed (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No-shows (1)' })).toBeInTheDocument();
    expect(screen.getByText('Kavin P')).toBeInTheDocument();
    expect(screen.getByText(/due today/)).toBeInTheDocument();
    expect(screen.getByText('reassess knee')).toBeInTheDocument();
  });

  it('messages the patient with a pre-filled WhatsApp, then shows it was messaged', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Message patient' }));
    expect(sendText).toHaveBeenCalledWith(expect.stringContaining('Dr Asha would like to see you for a review'), '9820000002');
    expect(screen.getByRole('button', { name: 'Messaged ✓' })).toBeInTheDocument();
  });

  it('Book hands over the patient, therapist and the due date; Dismiss clears the follow-up', () => {
    const { onBook } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    expect(onBook).toHaveBeenCalledWith({ patientId: 'p1', therapistId: 't1', date: today });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(setFollowUp).toHaveBeenCalledWith('p1', null);
  });

  it('Missed uses the "still planning to come in" wording; No-shows has no Dismiss', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /Missed/ }));
    expect(screen.getByText(/Missed · was due/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Message patient' }));
    expect(sendText).toHaveBeenCalledWith(expect.stringContaining('still planning to come in'), '9820000002');
    fireEvent.click(screen.getByRole('button', { name: /No-shows/ }));
    expect(screen.getByText(/No-show ·/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('will not message someone who asked not to be, or who has no number', () => {
    setup({
      data: {
        due: [
          { patient: patient({ id: 'a', name: 'No Msg', doNotMessage: true }), dueOn: today, daysFromDue: 0 },
          { patient: patient({ id: 'b', name: 'No Phone', phone: null }), dueOn: today, daysFromDue: 0 },
        ],
        missed: [],
        noShows: [],
      },
    });
    for (const button of screen.getAllByRole('button', { name: 'Message patient' })) expect(button).toBeDisabled();
  });

  it('says how to set a review when none exist, instead of showing nothing', () => {
    setup({ data: { due: [], missed: [], noShows: [] } });
    expect(screen.getByText(/No reviews due\./)).toBeInTheDocument();
    expect(screen.getByText(/Ask them back for a review/)).toBeInTheDocument();
  });

  it('hides Message when the clinic has patient messaging off', () => {
    setup({ canMessage: false });
    expect(screen.queryByRole('button', { name: 'Message patient' })).toBeNull();
  });
});
