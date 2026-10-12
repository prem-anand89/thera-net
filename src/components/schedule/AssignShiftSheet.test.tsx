// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssignShiftSheet } from './AssignShiftSheet';
import type { ShiftTemplate } from '@/domain/types';

let templates: ShiftTemplate[];
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
const assignShift = vi.fn();
vi.mock('@/services', () => ({
  // useLiveQuery is mocked to call the querier synchronously (see
  // dexie-react-hooks mock below), so this must return a plain value
  // rather than a promise, matching ShiftTemplatesSection.test.tsx's convention.
  repos: { shiftTemplates: { list: () => templates } },
  bookingService: { assignShift: (...a: unknown[]) => assignShift(...a) },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('AssignShiftSheet', () => {
  it('assigns the picked template and weekdays immediately, then closes', async () => {
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' }];
    assignShift.mockResolvedValue('a1');
    const onClose = vi.fn();
    render(<AssignShiftSheet open therapistId="th1" therapistName="Priya" clinicId="c1" onClose={onClose} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } });
    fireEvent.click(screen.getByLabelText('Mon'));
    fireEvent.click(screen.getByRole('button', { name: /assign shift/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(assignShift).toHaveBeenCalledWith({ therapistId: 'th1', shiftTemplateId: 't1', weekdays: [1] });
  });

  it('shows a message with no fallback link when no templates exist', () => {
    templates = [];
    render(<AssignShiftSheet open therapistId="th1" therapistName="Priya" clinicId="c1" onClose={() => {}} />);
    expect(screen.getByText(/No shift templates set up yet/)).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('supports quick weekday presets and displays closed weekday indicators', async () => {
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' }];
    assignShift.mockResolvedValue('a1');
    const onClose = vi.fn();
    render(
      <AssignShiftSheet
        open
        therapistId="th1"
        therapistName="Priya"
        clinicId="c1"
        closedWeekdays={[0]}
        onClose={onClose}
      />
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } });
    expect(screen.getByText('(Closed)')).toBeInTheDocument();

    // Click Mon–Fri preset
    fireEvent.click(screen.getByRole('button', { name: 'Mon–Fri' }));
    fireEvent.click(screen.getByRole('button', { name: /assign shift/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(assignShift).toHaveBeenCalledWith({
      therapistId: 'th1',
      shiftTemplateId: 't1',
      weekdays: [1, 2, 3, 4, 5],
    });
  });
});
