// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShiftTemplatesSection } from './ShiftTemplatesSection';
import type { ShiftTemplate } from '@/domain/types';

let templates: ShiftTemplate[];
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
const createShiftTemplate = vi.fn();
const updateShiftTemplate = vi.fn();
vi.mock('@/services', () => ({
  // useLiveQuery is mocked to call the querier synchronously (see
  // dexie-react-hooks mock below), so this must return a plain value
  // rather than a promise, matching CatalogSection.test.tsx's convention.
  repos: { shiftTemplates: { list: () => templates } },
  bookingService: { createShiftTemplate: (...args: unknown[]) => createShiftTemplate(...args), updateShiftTemplate: (...args: unknown[]) => updateShiftTemplate(...args) },
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ShiftTemplatesSection', () => {
  it('lists existing templates with their hours and break', () => {
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 30, defaultBreakStartMinute: 660, active: true, updatedAt: '' }];
    render(<ShiftTemplatesSection />);
    expect(screen.getByText('Morning')).toBeInTheDocument();
    expect(screen.getByText('9:00 AM – 1:00 PM')).toBeInTheDocument();
    expect(screen.getByText(/30-min break/)).toBeInTheDocument();
  });

  it('creates a template from the add form', () => {
    templates = [];
    render(<ShiftTemplatesSection />);
    fireEvent.change(screen.getByPlaceholderText('Morning shift'), { target: { value: 'Evening' } });
    fireEvent.click(screen.getByRole('button', { name: /add shift template/i }));
    expect(createShiftTemplate).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'c1', name: 'Evening' }));
  });

  it('deactivates a template', () => {
    templates = [{ id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '' }];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(updateShiftTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateId: 't1', active: false }));
  });
});
