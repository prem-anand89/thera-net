// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
import { addDays, localDateTime } from '@/domain/schedule';
import { HistoryView } from './HistoryView';

const today = '2026-10-01';
let n = 0;
const appt = (daysAgo: number, over: Partial<Appointment> = {}): Appointment => ({
  id: `a${n++}`, clinicId: 'c', patientId: null, patientName: `P${n}`, patientPhone: '98', therapistId: 't1',
  scheduledAt: localDateTime(addDays(today, -daysAgo), '10:00').toISOString(), durationMinutes: 30, status: 'arrived',
  requestId: null, visitId: null, rescheduleCount: 0, previousScheduledAt: null, createdAt: '', updatedAt: '', ...over,
});

function setup(appointments: Appointment[]) {
  const onSelect = vi.fn();
  render(
    <HistoryView
      appointments={appointments}
      therapists={[{ id: 't1', name: 'Dr A' }]}
      today={today}
      colorFor={() => '#000'}
      therapistNameFor={() => 'Dr A'}
      onSelect={onSelect}
    />
  );
  return { onSelect };
}

describe('HistoryView', () => {
  afterEach(cleanup);

  it('shows the last 30 days by default, with outcome counters that filter', () => {
    setup([appt(1), appt(2, { status: 'no_show', patientName: 'Missed' }), appt(3, { status: 'cancelled' }), appt(45, { patientName: 'Old' })]);
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 attended' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '1 no-show' }));
    expect(screen.getByText('Missed')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    // Wider range brings older visits in.
    fireEvent.click(screen.getByRole('button', { name: '1 no-show' }));
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: '90' } });
    expect(screen.getByText('Old')).toBeInTheDocument();
  });

  it('groups by day with counts, and pages after 50 rows', () => {
    setup(Array.from({ length: 55 }, () => appt(1)));
    const group = screen.getByRole('region', { name: 'Yesterday' });
    expect(within(group).getAllByRole('listitem')).toHaveLength(50);
    fireEvent.click(screen.getByRole('button', { name: 'Show more (5 left)' }));
    expect(within(group).getAllByRole('listitem')).toHaveLength(55);
  });

  it('searches by name and opens a row', () => {
    const { onSelect } = setup([appt(1, { patientName: 'Radhika' }), appt(1, { patientName: 'Aaron' })]);
    fireEvent.change(screen.getByLabelText('Search name or phone'), { target: { value: 'rad' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /Radhika/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ patientName: 'Radhika' }));
  });
});
