// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
import { localDateTime } from '@/domain/schedule';
import { AgendaList } from './AgendaList';

const appt = (time: string, over: Partial<Appointment> = {}): Appointment => ({
  id: `a-${time}`,
  clinicId: 'c',
  patientId: null,
  patientName: `Patient ${time}`,
  patientPhone: '1',
  therapistId: 't1',
  scheduledAt: localDateTime('2026-10-14', time).toISOString(),
  durationMinutes: 60,
  status: 'confirmed',
  requestId: null,
  visitId: null,
  rescheduleCount: 0,
  previousScheduledAt: null,
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('AgendaList', () => {
  afterEach(cleanup);

  it('renders a single now indicator at the current time position without duplication', () => {
    // 11:30 AM appointment (duration 60m -> ends 12:30 PM)
    const appt1130 = appt('11:30', { patientName: 'Rathan', therapistId: 't1' });
    // 12:00 PM free gap for another therapist (12:00 PM to 2:00 PM)
    const gap1200 = {
      start: 12 * 60,
      end: 14 * 60,
      therapistId: 't2',
      therapistName: 'Anand',
    };

    // Current time is 12:01 PM (721 minutes)
    const nowMinutes = 12 * 60 + 1;

    render(
      <AgendaList
        appointments={[appt1130]}
        gaps={[gap1200]}
        slotMinutes={30}
        colorFor={() => '#000'}
        therapistNameFor={() => 'Prem Anand'}
        showTherapist
        nowMinutes={nowMinutes}
        onSelect={vi.fn()}
      />
    );

    // Verify exactly ONE 'Now' indicator is rendered
    const nowIndicators = screen.getAllByRole('listitem', { name: 'Now' });
    expect(nowIndicators).toHaveLength(1);
    expect(within(nowIndicators[0]).getByText('12:01 PM')).toBeInTheDocument();

    // Verify appointment and gap are both rendered
    expect(screen.getByText('Rathan')).toBeInTheDocument();
    expect(screen.getByText(/Anand free 2h/)).toBeInTheDocument();
  });
});
