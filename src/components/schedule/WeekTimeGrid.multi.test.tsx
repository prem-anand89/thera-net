// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Appointment } from '@/domain/types';
import { localDateTime } from '@/domain/schedule';
import { WeekTimeGrid, type GridTherapist } from './TimeGrid';

const OPEN = { closed: false, kind: null, label: null } as const;
const DAY = '2026-10-02';

function appointment(overrides: Partial<Appointment>): Appointment {
  return {
    id: 'a1', clinicId: 'c1', patientId: 'p1', patientName: 'Priya Sharma', patientPhone: '1',
    therapistId: 't1', scheduledAt: localDateTime(DAY, '10:00').toISOString(), durationMinutes: 60,
    status: 'confirmed', requestId: null, visitId: null, rescheduleCount: 0, previousScheduledAt: null,
    createdAt: '', updatedAt: '', ...overrides,
  };
}

const therapists: GridTherapist[] = ['t1', 't2', 't3', 't4', 't5', 't6'].map((id, i) => ({
  id, name: `Dr Name${i + 1}`, color: '#468adb',
}));

type Props = Parameters<typeof WeekTimeGrid>[0];

function props(overrides: Partial<Props> = {}, multi: Partial<NonNullable<Props['multi']>> = {}): Props {
  return {
    days: [DAY],
    today: '2026-10-01',
    nowMinutes: 0,
    appointments: [],
    hours: { startHour: 9, endHour: 12 },
    slotMinutes: 30,
    closedFor: () => OPEN,
    colorFor: () => '#468adb',
    selectedId: null,
    onSelect: vi.fn(),
    onOpenDay: vi.fn(),
    multi: {
      therapists,
      canBookFor: () => true,
      workingForTherapist: () => [{ start: 540, end: 720 }],
      onBookFree: vi.fn(),
      ...multi,
    },
    ...overrides,
  };
}

describe('WeekTimeGrid with several therapists', () => {
  afterEach(cleanup);

  it('one appointment shows the therapist pill, the patient and the start time', () => {
    const { container } = render(<WeekTimeGrid {...props({ appointments: [appointment({})] })} />);
    expect(container.querySelectorAll('[data-therapist-pill]')).toHaveLength(1);
    expect(container.querySelector('[data-therapist-pill]')).toHaveTextContent('Name1');
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
    expect(screen.getByText('10:00 AM')).toBeInTheDocument();
  });

  it('simultaneous appointments of different therapists sit side by side (narrow lanes show initials, no hover needed)', () => {
    const appts = ['t1', 't2', 't3'].map((t, i) => appointment({ id: `a${i}`, therapistId: t, patientName: `Patient${i} Test` }));
    const { container } = render(<WeekTimeGrid {...props({ appointments: appts })} />);
    expect(container.querySelectorAll('[data-therapist-pill]')).toHaveLength(0);
    expect(screen.getAllByText('PT')).toHaveLength(3);
    const lefts = screen.getAllByRole('button', { name: /^Patient\d Test/ }).map((b) => b.style.left);
    expect(new Set(lefts).size).toBe(3);
  });

  it('shows at most three lanes; the rest sit behind a +N chip that lists them and opens details', () => {
    const appts = ['t1', 't2', 't3', 't4', 't5'].map((t, i) => appointment({ id: `a${i}`, therapistId: t, patientName: `Patient${i} Test` }));
    const onSelect = vi.fn();
    const { container } = render(<WeekTimeGrid {...props({ appointments: appts, onSelect })} />);
    expect(container.querySelectorAll('button[title*="Patient"]')).toHaveLength(3);
    const chip = screen.getByRole('button', { name: '2 more appointments at 10:00 AM' });
    expect(chip).toHaveTextContent('+2');
    fireEvent.click(chip);
    const list = document.querySelector('[data-overflow-list]')!;
    expect(list).toHaveTextContent('Patient3 Test');
    expect(list).toHaveTextContent('Patient4 Test');
    expect(list).toHaveTextContent('Name4');
    fireEvent.click(screen.getByRole('button', { name: /^Patient4 Test/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a4' }));
  });

  it('has no therapist cap: six therapists render without a banner', () => {
    render(<WeekTimeGrid {...props()} />);
    expect(screen.queryByText(/Showing first/)).toBeNull();
  });

  it('free time is tinted while any bookable therapist is free, and not when all are booked', () => {
    const two = therapists.slice(0, 2);
    const free = render(<WeekTimeGrid {...props({ appointments: [appointment({ therapistId: 't1' })] }, { therapists: two })} />);
    const at10 = free.container.querySelector('button[aria-label^="Book"][aria-label*="10:00 AM"]');
    expect(at10?.className).toContain('bg-[var(--moss-light)]/40');
    cleanup();
    const booked = render(
      <WeekTimeGrid {...props({ appointments: two.map((t) => appointment({ id: t.id, therapistId: t.id })) }, { therapists: two })} />
    );
    expect(booked.container.querySelector('button[aria-label^="Book"][aria-label*="10:00 AM"]')).toBeNull();
  });

  it('time nobody works stays blank, and booking only counts bookable therapists', () => {
    const { container } = render(
      <WeekTimeGrid
        {...props({}, {
          therapists: therapists.slice(0, 2),
          workingForTherapist: () => [{ start: 600, end: 660 }],
          canBookFor: (id) => id === 't2',
        })}
      />
    );
    expect(container.querySelector('button[aria-label*="9:00 AM"]')).toBeNull();
    expect(container.querySelector('button[aria-label*="10:00 AM"]')).not.toBeNull();
  });

  it('tapping free time offers only the therapists free then', () => {
    const onBookFree = vi.fn();
    const two = therapists.slice(0, 2);
    const { container } = render(<WeekTimeGrid {...props({ appointments: [appointment({ therapistId: 't1' })] }, { therapists: two, onBookFree })} />);
    fireEvent.click(container.querySelector('button[aria-label^="Book"][aria-label*="10:00 AM"]')!);
    expect(onBookFree).toHaveBeenCalledWith({ date: DAY, time: '10:00', freeTherapistIds: ['t2'] });
  });
});
