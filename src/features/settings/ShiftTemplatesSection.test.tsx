// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShiftTemplatesSection } from './ShiftTemplatesSection';
import type { ShiftTemplate, Therapist, TherapistShiftAssignment } from '@/domain/types';

let templates: ShiftTemplate[];
let assignments: TherapistShiftAssignment[];
let therapists: Therapist[];

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (query: () => unknown) => query() }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1' }) }));
const createShiftTemplate = vi.fn();
vi.mock('@/lib/errors', () => ({ toFriendlyMessage: (e: Error) => e.message }));
const updateShiftTemplate = vi.fn();

vi.mock('@/services', () => ({
  repos: {
    shiftTemplates: { list: () => templates },
    therapistShiftAssignments: { listByClinic: () => assignments },
    therapists: { list: () => therapists },
  },
  bookingService: {
    createShiftTemplate: (...args: unknown[]) => createShiftTemplate(...args),
    updateShiftTemplate: (...args: unknown[]) => updateShiftTemplate(...args),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  assignments = [];
  therapists = [];
});

describe('ShiftTemplatesSection', () => {
  it('lists existing templates with their hours and break', () => {
    templates = [
      {
        id: 't1',
        clinicId: 'c1',
        name: 'Morning',
        startMinute: 540,
        endMinute: 780,
        breakDurationMinutes: 30,
        defaultBreakStartMinute: 660,
        active: true,
        updatedAt: '',
      },
    ];
    render(<ShiftTemplatesSection />);
    expect(screen.getByText('Morning')).toBeInTheDocument();
    expect(screen.getByText(/9:00 AM – 1:00 PM/)).toBeInTheDocument();
    expect(screen.getByText(/30-min break/)).toBeInTheDocument();
  });

  it('renders split shifts with morning and evening ranges when break >= 120m', () => {
    templates = [
      {
        id: 't-split',
        clinicId: 'c1',
        name: 'Split Shift',
        startMinute: 540,
        endMinute: 1200,
        breakDurationMinutes: 180,
        defaultBreakStartMinute: 780,
        active: true,
        updatedAt: '',
      },
    ];
    render(<ShiftTemplatesSection />);
    expect(screen.getByText('SPLIT SHIFT')).toBeInTheDocument();
    expect(screen.getByText(/Morning: 9:00 AM – 1:00 PM & Evening: 4:00 PM – 8:00 PM/)).toBeInTheDocument();
  });

  it('shows impact warning when editing a template used by active therapists', () => {
    templates = [
      {
        id: 't1',
        clinicId: 'c1',
        name: 'General',
        startMinute: 540,
        endMinute: 1020,
        breakDurationMinutes: 60,
        defaultBreakStartMinute: 780,
        active: true,
        updatedAt: '',
      },
    ];
    therapists = [
      { id: 'th1', clinicId: 'c1', name: 'Dr Prem', active: true, updatedAt: '' },
    ];
    assignments = [
      {
        id: 'a1',
        clinicId: 'c1',
        therapistId: 'th1',
        shiftTemplateId: 't1',
        customHours: null,
        weekdays: [1, 2],
        breakStartMinute: null,
        status: 'approved',
        note: null,
        requestedBy: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '',
        updatedAt: '',
      },
    ];

    render(<ShiftTemplatesSection />);
    expect(screen.getByText('Used by 1')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText(/Impact warning:/)).toBeInTheDocument();
    expect(screen.getByText(/Currently assigned to Dr Prem/)).toBeInTheDocument();
  });

  it('creates a template from the add form', () => {
    templates = [];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Add shift template/i }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Morning Shift/i), {
      target: { value: 'Evening' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create shift template/i }));
    expect(createShiftTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ clinicId: 'c1', name: 'Evening' })
    );
  });

  it('deactivates a template', () => {
    templates = [
      {
        id: 't1',
        clinicId: 'c1',
        name: 'Morning',
        startMinute: 540,
        endMinute: 780,
        breakDurationMinutes: 0,
        defaultBreakStartMinute: null,
        active: true,
        updatedAt: '',
      },
    ];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(updateShiftTemplate).toHaveBeenCalledWith(
      expect.objectContaining({ templateId: 't1', active: false })
    );
  });

  it('shows inactive templates behind toggle', () => {
    templates = [
      {
        id: 't-inactive',
        clinicId: 'c1',
        name: 'Old Shift',
        startMinute: 540,
        endMinute: 780,
        breakDurationMinutes: 0,
        defaultBreakStartMinute: null,
        active: false,
        updatedAt: '',
      },
    ];
    render(<ShiftTemplatesSection />);
    expect(screen.queryByText('Old Shift')).not.toBeInTheDocument();
    expect(screen.getByText(/Show inactive templates \(1\)/)).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Show inactive templates/));
    expect(screen.getByText('Old Shift')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivate' })).toBeInTheDocument();
  });

  it('shows an error when creating a template fails', async () => {
    templates = [];
    createShiftTemplate.mockRejectedValueOnce(new Error('Could not create shift template: boom'));
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Add shift template/i }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Morning Shift/i), {
      target: { value: 'Evening' },
    });
    fireEvent.click(screen.getByRole('button', { name: /create shift template/i }));
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });

  it('shows an error when deactivating fails', async () => {
    templates = [
      {
        id: 't1',
        clinicId: 'c1',
        name: 'Morning',
        startMinute: 540,
        endMinute: 780,
        breakDurationMinutes: 0,
        defaultBreakStartMinute: null,
        active: true,
        updatedAt: '',
      },
    ];
    updateShiftTemplate.mockRejectedValueOnce(new Error('offline'));
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });

  it('shows an error when saving an edit fails', async () => {
    templates = [
      {
        id: 't1',
        clinicId: 'c1',
        name: 'Morning',
        startMinute: 540,
        endMinute: 780,
        breakDurationMinutes: 0,
        defaultBreakStartMinute: null,
        active: true,
        updatedAt: '',
      },
    ];
    updateShiftTemplate.mockRejectedValueOnce(new Error('bad bounds'));
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('bad bounds')).toBeInTheDocument();
  });
});
