// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShiftRequestSheet } from './ShiftRequestSheet';
import type { ShiftTemplate } from '@/domain/types';

let templates: ShiftTemplate[];
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
let workingHoursProps: { value: unknown; onSave: (h: unknown) => Promise<void> } | null = null;
vi.mock('./WorkingHoursSheet', () => ({
  WorkingHoursSheet: (props: { value: unknown; onSave: (h: unknown) => Promise<void> }) => {
    workingHoursProps = props;
    return <div>custom-hours-sheet</div>;
  },
}));
const requestShiftAssignment = vi.fn();
const requestCustomHours = vi.fn();
vi.mock('@/services', () => ({
  // useLiveQuery is mocked to call the querier synchronously (see
  // dexie-react-hooks mock below), so this must return a plain value
  // rather than a promise, matching ShiftTemplatesSection.test.tsx's convention.
  repos: { shiftTemplates: { list: () => templates } },
  bookingService: { requestShiftAssignment: (...a: unknown[]) => requestShiftAssignment(...a), requestCustomHours: (...a: unknown[]) => requestCustomHours(...a) },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const clinic = { startHour: 9, endHour: 17 };

describe('ShiftRequestSheet', () => {
  it('submits a shift request with the picked template and weekdays', async () => {
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' }];
    render(<ShiftRequestSheet open therapistId="th1" therapistName="Priya" clinicId="c1" clinic={clinic} currentWorkingHours={null} onClose={() => {}} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByRole('button', { name: /submit request/i }));
    await screen.findByText(/waiting on approval/i);
    expect(requestShiftAssignment).toHaveBeenCalledWith({ therapistId: 'th1', shiftTemplateId: 't1', weekdays: [1] });
  });

  it('falls through to custom hours when no templates exist', () => {
    templates = [];
    render(<ShiftRequestSheet open therapistId="th1" therapistName="Priya" clinicId="c1" clinic={clinic} currentWorkingHours={null} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/set custom hours instead/i));
    expect(screen.getByText('custom-hours-sheet')).toBeInTheDocument();
  });

  it('pre-fills the custom-hours fallback with current hours and confirms submission', async () => {
    templates = [];
    const current = { '1': [[540, 780]] as [number, number][] };
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<ShiftRequestSheet open therapistId="th1" therapistName="Priya" clinicId="c1" clinic={clinic} currentWorkingHours={current} onClose={() => {}} />);
    fireEvent.click(screen.getByText(/set custom hours instead/i));
    expect(workingHoursProps?.value).toBe(current);
    await workingHoursProps!.onSave(null);
    expect(requestCustomHours).toHaveBeenCalledWith('th1', null);
    expect(alert).toHaveBeenCalledWith(expect.stringMatching(/waiting on approval/i));
    alert.mockRestore();
  });

  it('labels the dialog by its heading and the shift select', () => {
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' }];
    render(<ShiftRequestSheet open therapistId="th1" therapistName="Priya" clinicId="c1" clinic={clinic} currentWorkingHours={null} onClose={() => {}} />);
    expect(screen.getByRole('dialog', { name: 'My working hours' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Shift' })).toBeInTheDocument();
  });
});
