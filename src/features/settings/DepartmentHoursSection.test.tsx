// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Clinic } from '@/domain/types';
import { departmentHours, isDepartmentClosedOn } from '@/domain/departmentHours';
import { DepartmentHoursSection, cleanDepartmentHours } from './DepartmentHoursSection';
import { ClosedDaysSheet } from '@/components/schedule/ClosedDaysSheet';

const mockPut = vi.fn();
let mockClinic: Clinic = {
  id: 'c1',
  name: 'Ortho Physio',
  careLocations: ['clinic', 'home', 'ward'],
  bookingStartHour: 9,
  bookingEndHour: 17,
  slotDurationMinutes: 30,
  startStepMinutes: 15,
  closedWeekdays: [0],
  departmentHours: null,
} as unknown as Clinic;

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => mockClinic,
}));

vi.mock('@/services', () => ({
  repos: {
    clinics: {
      get: async () => mockClinic,
      put: (c: Clinic) => mockPut(c),
    },
  },
  bookingService: {
    setClosedDates: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => null,
  publicLogoUrl: () => null,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-router')>();
  return {
    ...actual,
    Link: ({ children, to }: { children: React.ReactNode; to?: string }) => <a href={to ?? '#'}>{children}</a>,
  };
});

describe('DepartmentHoursSection (G10)', () => {
  afterEach(() => {
    cleanup();
    mockPut.mockClear();
  });

  it('hidden when clinic has only one department', () => {
    mockClinic = {
      ...mockClinic,
      careLocations: ['clinic'],
    };
    const { container } = render(<DepartmentHoursSection onDirtyChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders cards for Home and Inpatient when clinic has multiple places', () => {
    mockClinic = {
      ...mockClinic,
      careLocations: ['clinic', 'home', 'ward'],
    };
    render(<DepartmentHoursSection onDirtyChange={vi.fn()} />);
    expect(screen.getByText('Hours by place')).toBeInTheDocument();
    expect(screen.getByTestId('department-hours-home')).toBeInTheDocument();
    expect(screen.getByTestId('department-hours-ward')).toBeInTheDocument();
  });

  it('changing Home hours leaves OP unchanged and stores override', async () => {
    mockClinic = {
      ...mockClinic,
      careLocations: ['clinic', 'home', 'ward'],
      departmentHours: null,
    };
    render(<DepartmentHoursSection onDirtyChange={vi.fn()} />);

    // Change Home start time to 8:00 (8)
    const homeStart = screen.getByLabelText('Home Start time');
    fireEvent.change(homeStart, { target: { value: '8' } });

    // Change Home slot length to 60 minutes
    const homeSlot = screen.getByLabelText('Home Appointment length');
    fireEvent.change(homeSlot, { target: { value: '60' } });

    // Save button should appear
    const saveBtn = screen.getByRole('button', { name: 'Save' });
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockPut).toHaveBeenCalled();
    });

    const savedClinic = mockPut.mock.calls[0][0] as Clinic;
    expect(savedClinic.departmentHours?.home?.startHour).toBe(8);
    expect(savedClinic.departmentHours?.home?.slotMinutes).toBe(60);

    // Verify OP hours remain unchanged
    const opResolved = departmentHours(savedClinic, 'clinic');
    expect(opResolved.clinicHours.startHour).toBe(9);
    expect(opResolved.slotMinutes).toBe(30);

    // Verify Home hours resolved
    const homeResolved = departmentHours(savedClinic, 'home');
    expect(homeResolved.clinicHours.startHour).toBe(8);
    expect(homeResolved.slotMinutes).toBe(60);
  });

  it('"Same as OP" stores nothing (cleanDepartmentHours produces null)', () => {
    const emptyOverrides = {
      home: {
        startHour: undefined,
        endHour: undefined,
        slotMinutes: undefined,
        closedWeekdays: undefined,
      },
      ward: {},
    };
    expect(cleanDepartmentHours(emptyOverrides)).toBeNull();
  });

  it('holiday ticked for OP only leaves Home and Ward open', async () => {
    const { bookingService } = await import('@/services');
    mockClinic = {
      ...mockClinic,
      careLocations: ['clinic', 'home', 'ward'],
    };

    render(
      <ClosedDaysSheet
        open={true}
        clinicId="c1"
        initialDate="2026-11-18"
        onClose={vi.fn()}
      />
    );

    // Uncheck Home and IP, leave OP checked
    const homeCareCheckbox = screen.getByLabelText('Home');
    const ipCheckbox = screen.getByLabelText('IP');
    fireEvent.click(homeCareCheckbox);
    fireEvent.click(ipCheckbox);

    // Click Mark closed
    const markClosedBtn = screen.getByRole('button', { name: 'Mark closed' });
    fireEvent.click(markClosedBtn);

    await waitFor(() => {
      expect(bookingService.setClosedDates).toHaveBeenCalledWith(
        'c1',
        '2026-11-18',
        '2026-11-18',
        null,
        ['clinic']
      );
    });

    // Verify domain behavior with this holiday
    const closedDates = [{ closedDate: '2026-11-18', departments: ['clinic' as const] }];
    expect(isDepartmentClosedOn(mockClinic, 'clinic', '2026-11-18', closedDates)).toBe(true);
    expect(isDepartmentClosedOn(mockClinic, 'home', '2026-11-18', closedDates)).toBe(false);
    expect(isDepartmentClosedOn(mockClinic, 'ward', '2026-11-18', closedDates)).toBe(false);
  });
});
