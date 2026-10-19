// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
import { localDateTime } from '@/domain/schedule';
import { AgendaList, gapHourRows } from './AgendaList';

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
    // Free time is shown as bookable time buttons (owner decision: no "free 2h" text).
    expect(screen.getByRole('button', { name: /12:00 PM/ })).toBeInTheDocument();
  });

  it('hides flags and reason and shows "view only" for colleague appointment rows', () => {
    const colleagueAppt = appt('10:00', {
      id: 'a-colleague',
      patientId: 'p1',
      patientName: 'Ananya',
      therapistId: 't-colleague',
    });

    const flagContext = {
      patientIdsWithVisits: new Set<string>(),
      packages: new Map(),
      balanceDue: new Set(['p1']),
      noShows: new Map(),
      conditionByPatient: new Map([['p1', 'Knee rehab']]),
      requestNotes: new Map(),
    };

    render(
      <AgendaList
        appointments={[colleagueAppt]}
        gaps={[]}
        slotMinutes={30}
        colorFor={() => '#000'}
        therapistNameFor={() => 'Dr Anand'}
        showTherapist
        nowMinutes={null}
        onSelect={vi.fn()}
        flagContext={flagContext}
        isColleague={(a) => a.id === 'a-colleague'}
      />
    );

    // Patient name is visible with view only tag
    expect(screen.getByText('Ananya')).toBeInTheDocument();
    expect(screen.getByText('· view only')).toBeInTheDocument();

    // Reason and flags are NOT rendered
    expect(screen.queryByText('Knee rehab')).not.toBeInTheDocument();
    expect(screen.queryByText('Balance due')).not.toBeInTheDocument();
    expect(screen.queryByText('New patient')).not.toBeInTheDocument();
  });

  it('shows flags and reason without "view only" for own appointment rows', () => {
    const ownAppt = appt('10:00', {
      id: 'a-own',
      patientId: 'p1',
      patientName: 'Ananya',
      therapistId: 't-own',
    });

    const flagContext = {
      patientIdsWithVisits: new Set<string>(),
      packages: new Map(),
      balanceDue: new Set(['p1']),
      noShows: new Map(),
      conditionByPatient: new Map([['p1', 'Knee rehab']]),
      requestNotes: new Map(),
    };

    render(
      <AgendaList
        appointments={[ownAppt]}
        gaps={[]}
        slotMinutes={30}
        colorFor={() => '#000'}
        therapistNameFor={() => 'Dr Anand'}
        showTherapist
        nowMinutes={null}
        onSelect={vi.fn()}
        flagContext={flagContext}
        isColleague={() => false}
      />
    );

    // Patient name visible without view only tag
    expect(screen.getByText('Ananya')).toBeInTheDocument();
    expect(screen.queryByText('· view only')).not.toBeInTheDocument();

    // Reason and flags ARE rendered for own row
    expect(screen.getByText('Knee rehab')).toBeInTheDocument();
    expect(screen.getByText('Balance due')).toBeInTheDocument();
  });

  describe('free time', () => {
    const base = {
      slotMinutes: 30,
      colorFor: () => '#468adb',
      therapistNameFor: () => 'Dr Asha',
      showTherapist: false,
      nowMinutes: null,
      onSelect: vi.fn(),
    };

    it('gapHourRows splits a gap into one row of start times per clock hour, only slots that fit', () => {
      expect(gapHourRows({ start: 9 * 60, end: 11 * 60 + 15 }, 30)).toEqual([[540, 570], [600, 630]]);
      expect(gapHourRows({ start: 540, end: 560 }, 30)).toEqual([]);
    });

    it('shows free time as bare time buttons (no "free" text) that book at that time', () => {
      const onBookGap = vi.fn();
      render(<AgendaList {...base} appointments={[]} gaps={[{ start: 9 * 60, end: 11 * 60, therapistId: 't1' }]} onBookGap={onBookGap} />);
      expect(screen.queryByText(/free/i)).not.toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /^Book / })).toHaveLength(4);
      fireEvent.click(screen.getByRole('button', { name: 'Book at 10:30 AM' }));
      expect(onBookGap).toHaveBeenCalledWith('10:30', 't1');
    });
  });
});
