// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
import { localDateTime } from '@/domain/schedule';

// ---- mocks -----------------------------------------------------------------
const scope = { myTherapistId: 't1' as string | undefined };
const data = {
  therapists: [
    { id: 't1', name: 'Dr Asha' },
    { id: 't2', name: 'Dr Ravi' },
  ],
  patients: [
    { id: 'p1', name: 'Priya', phone: '9820000001' },
    { id: 'p2', name: 'Noor', phone: null },
  ],
  closed: [] as { closedDate: string; label: string | null }[],
};
const confirmBookingSlot = vi.fn(async () => 'new-id');
const rescheduleAppointment = vi.fn(async () => undefined);
const confirmBookingSeries = vi.fn(async () => 'series-1');
const openPackages = vi.fn(() => [{ patientId: 'p1', packageTotal: 10, sessionsLogged: 6 }]);

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => ({
    id: 'c1',
    name: 'Clinic',
    slotDurationMinutes: 30,
    bookingStartHour: 9,
    bookingEndHour: 12,
    closedWeekdays: [0],
  }),
}));
vi.mock('@/app/useWorkspaceScope', () => ({ useWorkspaceScope: () => scope }));
// Repos below return plain arrays, so the live query can resolve synchronously.
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
vi.mock('@/services', () => ({
  repos: {
    therapists: { list: () => data.therapists },
    patients: { list: () => data.patients },
    clinicClosedDates: { listByClinic: () => data.closed },
  },
  bookingService: {
    confirmBookingSlot: (...args: unknown[]) => confirmBookingSlot(...(args as [])),
    rescheduleAppointment: (...args: unknown[]) => rescheduleAppointment(...(args as [])),
    confirmBookingSeries: (...args: unknown[]) => confirmBookingSeries(...(args as [])),
  },
  dashboardService: { openPackages: () => openPackages() },
}));
vi.mock('@/components/SearchableSelect', () => ({
  SearchableSelect: ({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) => (
    <select aria-label="Patient search" value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">—</option>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

import { BookSlotSheet } from './BookSlotSheet';

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: 'a1',
    clinicId: 'c1',
    patientId: null,
    patientName: 'Kiran',
    patientPhone: '9820000009',
    therapistId: 't1',
    scheduledAt: localDateTime('2026-10-01', '11:00').toISOString(),
    durationMinutes: 30,
    status: 'confirmed',
    requestId: null,
    visitId: null,
    rescheduleCount: 0,
    previousScheduledAt: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

const slot = (label: string) => screen.getByRole('button', { name: label });

describe('BookSlotSheet', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 30, 10, 0)); // Wed 30 Sep 2026, 10:00 local
    scope.myTherapistId = 't1';
    data.closed = [];
    confirmBookingSlot.mockClear();
    rescheduleAppointment.mockClear();
    confirmBookingSeries.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('defaults the therapist to the logged-in therapist', () => {
    render(<BookSlotSheet isOpen onClose={() => {}} />);
    expect(screen.getByLabelText('Therapist')).toHaveValue('t1');
  });

  it('disables times that have already passed today', () => {
    render(<BookSlotSheet isOpen onClose={() => {}} />);
    expect(slot('9:30 AM')).toBeDisabled();
    expect(slot('10:30 AM')).toBeEnabled();
  });

  it('disables occupied time for the chosen length, and time that runs past closing', () => {
    render(<BookSlotSheet isOpen onClose={() => {}} appointments={[appointment({})]} prefilledDate="2026-10-01" />);
    expect(slot('11:00 AM')).toBeDisabled();
    expect(slot('10:30 AM')).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '60' } });
    expect(slot('10:30 AM')).toBeDisabled(); // 10:30–11:30 hits the 11:00 booking
    // 11:30 + 60 min would end after the 12:00 close: listed under "Outside working hours", disabled.
    fireEvent.click(screen.getByRole('button', { name: /Outside working hours \(1\)/ }));
    expect(slot('11:30 AM')).toBeDisabled();
    expect(slot('9:00 AM')).toBeEnabled();
  });

  it("ignores other therapists' bookings", () => {
    render(<BookSlotSheet isOpen onClose={() => {}} appointments={[appointment({ therapistId: 't2' })]} prefilledDate="2026-10-01" />);
    expect(slot('11:00 AM')).toBeEnabled();
  });

  it('books a new patient and reports the result', async () => {
    const onBooked = vi.fn();
    const onClose = vi.fn();
    render(<BookSlotSheet isOpen onClose={onClose} onBooked={onBooked} prefilledDate="2026-10-01" />);
    fireEvent.click(screen.getByRole('button', { name: 'New patient' }));
    fireEvent.change(screen.getByLabelText('Patient name'), { target: { value: 'Meera' } });
    fireEvent.change(screen.getByLabelText('Phone'), { target: { value: '9820000002' } });
    fireEvent.change(screen.getByLabelText('Length'), { target: { value: '45' } });
    fireEvent.click(slot('9:00 AM'));
    fireEvent.click(screen.getByRole('button', { name: /^Confirm booking/ }));

    await waitFor(() => expect(onBooked).toHaveBeenCalled());
    const scheduledAt = localDateTime('2026-10-01', '09:00').toISOString();
    expect(confirmBookingSlot).toHaveBeenCalledWith({
      clinicId: 'c1',
      patientId: null,
      patientName: 'Meera',
      patientPhone: '9820000002',
      therapistId: 't1',
      scheduledAt,
      requestId: null,
      durationMinutes: 45,
    });
    expect(onBooked).toHaveBeenCalledWith(expect.objectContaining({ kind: 'booked', appointmentId: 'new-id', durationMinutes: 45 }));
    expect(onClose).toHaveBeenCalled();
  });

  it('asks for a phone when the chosen patient has none on file', async () => {
    render(<BookSlotSheet isOpen onClose={() => {}} prefilledDate="2026-10-01" />);
    fireEvent.change(screen.getByLabelText('Patient search'), { target: { value: 'p2' } });
    fireEvent.click(slot('9:00 AM'));
    fireEvent.click(screen.getByRole('button', { name: /^Confirm booking/ }));
    expect(await screen.findByText(/no phone on file/)).toBeInTheDocument();
    expect(confirmBookingSlot).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Phone (none on file)'), { target: { value: '9820000003' } });
    fireEvent.click(screen.getByRole('button', { name: /^Confirm booking/ }));
    await waitFor(() =>
      expect(confirmBookingSlot).toHaveBeenCalledWith(expect.objectContaining({ patientId: 'p2', patientPhone: '9820000003' }))
    );
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<BookSlotSheet isOpen onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('resets everything when reopened with different prefill', () => {
    const { rerender } = render(<BookSlotSheet isOpen onClose={() => {}} prefilledPatientName="Old" prefilledTherapistId="t2" />);
    expect(screen.getByLabelText('Patient name')).toHaveValue('Old');
    fireEvent.change(screen.getByLabelText('Patient name'), { target: { value: 'Edited' } });

    rerender(<BookSlotSheet isOpen={false} onClose={() => {}} />);
    rerender(<BookSlotSheet isOpen onClose={() => {}} prefilledDate="2026-10-01" />);
    // Back to "find" mode with no leftover name, and the therapist default re-applied.
    expect(screen.queryByLabelText('Patient name')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Therapist')).toHaveValue('t1');
  });

  it('warns on a closed day but still allows booking', () => {
    data.closed = [{ closedDate: '2026-10-02', label: 'Gandhi Jayanti' }];
    render(<BookSlotSheet isOpen onClose={() => {}} prefilledDate="2026-10-02" />);
    expect(screen.getByRole('status')).toHaveTextContent('closed this day (Gandhi Jayanti)');
    expect(slot('9:00 AM')).toBeEnabled();
  });

  it("offers only the therapist's working hours, with the rest collapsed", () => {
    data.therapists = [
      { id: 't1', name: 'Dr Asha', workingHours: { '4': [[540, 600], [660, 720]] } } as never, // Thu 9–10, 11–12
      { id: 't2', name: 'Dr Ravi' },
    ];
    try {
      render(<BookSlotSheet isOpen onClose={() => {}} prefilledDate="2026-10-01" />);
      expect(slot('9:30 AM')).toBeEnabled();
      expect(slot('11:00 AM')).toBeEnabled();
      expect(screen.queryByRole('button', { name: '10:00 AM' })).not.toBeInTheDocument(); // the break
      fireEvent.click(screen.getByRole('button', { name: /Outside working hours \(2\)/ }));
      expect(slot('10:00 AM')).toBeEnabled(); // staff may still book it
    } finally {
      data.therapists = [
        { id: 't1', name: 'Dr Asha' },
        { id: 't2', name: 'Dr Ravi' },
      ];
    }
  });

  it('locks the therapist for a therapist login', () => {
    render(<BookSlotSheet isOpen onClose={() => {}} lockTherapist prefilledTherapistId="t1" />);
    expect(screen.queryByLabelText('Therapist')).not.toBeInTheDocument();
    expect(screen.getByText('Dr Asha')).toBeInTheDocument();
  });

  it('reschedules: patient and therapist fixed, own slot free, calls reschedule', async () => {
    const moving = appointment({});
    const onBooked = vi.fn();
    render(
      <BookSlotSheet isOpen onClose={() => {}} onBooked={onBooked} appointments={[moving]} rescheduleAppointment={moving} />
    );
    expect(screen.getByRole('heading', { name: 'Reschedule' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New patient' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Therapist')).not.toBeInTheDocument();
    expect(slot('11:00 AM')).toBeEnabled(); // its own current slot is not "occupied"

    fireEvent.click(slot('11:30 AM'));
    fireEvent.click(screen.getByRole('button', { name: /^Move appointment/ }));
    await waitFor(() =>
      expect(rescheduleAppointment).toHaveBeenCalledWith('a1', localDateTime('2026-10-01', '11:30').toISOString(), 30)
    );
    expect(confirmBookingSlot).not.toHaveBeenCalled();
    expect(onBooked).toHaveBeenCalledWith(expect.objectContaining({ kind: 'rescheduled', appointmentId: 'a1' }));
  });
  it('summarises the choice on the submit button', () => {
    render(<BookSlotSheet isOpen onClose={() => {}} prefilledDate="2026-10-01" />);
    fireEvent.click(slot('10:30 AM'));
    expect(screen.getByRole('button', { name: /^Confirm booking · Thu, 1 Oct, 10:30 AM · 30m$/ })).toBeInTheDocument();
  });

  it('jumps to the first available time', () => {
    const busy = [
      appointment({ id: 'b1', scheduledAt: localDateTime('2026-09-30', '10:00').toISOString() }),
      appointment({ id: 'b2', scheduledAt: localDateTime('2026-09-30', '10:30').toISOString() }),
    ];
    render(<BookSlotSheet isOpen onClose={() => {}} appointments={busy} />);
    fireEvent.click(screen.getByRole('button', { name: 'First available →' }));
    // Now is 10:00 today; 10:00 and 10:30 are taken for t1 -> 11:00.
    expect(slot('11:00 AM')).toHaveClass('bg-[var(--teal)]');
  });

  it("shows the patient's no-show history and an existing booking", () => {
    const history = [
      appointment({ id: 'n1', patientId: 'p1', status: 'no_show', scheduledAt: localDateTime('2026-09-01', '10:00').toISOString() }),
      appointment({ id: 'n2', patientId: 'p1', status: 'no_show', scheduledAt: localDateTime('2026-09-10', '10:00').toISOString() }),
      appointment({ id: 'u1', patientId: 'p1', scheduledAt: localDateTime('2026-10-05', '09:00').toISOString() }),
    ];
    render(<BookSlotSheet isOpen onClose={() => {}} appointments={history} />);
    fireEvent.change(screen.getByLabelText('Patient search'), { target: { value: 'p1' } });
    expect(screen.getByText(/2 no-shows in the last 6 months/)).toBeInTheDocument();
    expect(screen.getByText(/Already booked: Mon, 5 Oct, 9:00 AM/)).toBeInTheDocument();
  });
  it('books a repeat series, defaulting the count to sessions left in the package', async () => {
    const busy = [appointment({ id: 'x', scheduledAt: localDateTime('2026-10-08', '10:00').toISOString() })];
    const onBooked = vi.fn();
    render(<BookSlotSheet isOpen onClose={() => {}} onBooked={onBooked} appointments={busy} prefilledDate="2026-10-01" />);
    fireEvent.change(screen.getByLabelText('Patient search'), { target: { value: 'p1' } });
    fireEvent.click(slot('10:00 AM'));
    fireEvent.click(screen.getByLabelText('Repeat this booking'));
    expect(screen.getByLabelText('Sessions')).toHaveValue(4); // 10 - 6 left in package
    const rows = within(screen.getByRole('list', { name: 'Planned sessions' })).getAllByRole('listitem');
    expect(rows).toHaveLength(4); // Thursdays from 1 Oct
    expect(rows[1]).toHaveTextContent('Thu, 8 Oct, 10:00 AM — clashes');
    expect(screen.getByText(/1 need a new time or skip/)).toBeInTheDocument();

    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Find a time' }));
    expect(within(screen.getByRole('list', { name: 'Planned sessions' })).getAllByRole('listitem')[1]).toHaveTextContent('Thu, 8 Oct, 9:00 AM');
    fireEvent.click(screen.getByRole('button', { name: /^Book 4 sessions/ }));
    await waitFor(() => expect(confirmBookingSeries).toHaveBeenCalled());
    const call = (confirmBookingSeries.mock.calls[0] as unknown[])[0] as { starts: string[]; patientId: string };
    expect(call.patientId).toBe('p1');
    expect(call.starts).toEqual([
      localDateTime('2026-10-01', '10:00').toISOString(),
      localDateTime('2026-10-08', '09:00').toISOString(),
      localDateTime('2026-10-15', '10:00').toISOString(),
      localDateTime('2026-10-22', '10:00').toISOString(),
    ]);
    expect(onBooked).toHaveBeenCalledWith(expect.objectContaining({ sessions: 4, appointmentId: 'series-1' }));
  });
});
