// @vitest-environment jsdom
import { askConfirm } from '@/lib/notify';
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
const plan = { maxMembers: 5, enforcementEnabled: true, loading: false };
vi.mock('@/app/useEntitlements', () => ({ useEntitlements: () => plan }));
const createShiftTemplate = vi.fn();
const updateShiftTemplate = vi.fn();
const deleteShiftTemplate = vi.fn();
const dbUpdate = vi.fn();
vi.mock('@/lib/errors', () => ({ toFriendlyMessage: (e: Error) => e.message }));
vi.mock('@/lib/db', () => ({
  db: {
    shift_templates: {
      update: (...args: unknown[]) => dbUpdate(...args),
    },
  },
}));

vi.mock('@/services', () => ({
  repos: {
    shiftTemplates: { list: () => templates },
    therapistShiftAssignments: { listByClinic: () => assignments },
    therapists: { list: () => therapists },
  },
  bookingService: {
    createShiftTemplate: (...args: unknown[]) => createShiftTemplate(...args),
    updateShiftTemplate: (...args: unknown[]) => updateShiftTemplate(...args),
    deleteShiftTemplate: (...args: unknown[]) => deleteShiftTemplate(...args),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  assignments = [];
  therapists = [];
});

vi.mock('@/lib/notify', () => ({ askConfirm: vi.fn(), notify: { error: vi.fn(), info: vi.fn() } }));

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
        decisionNote: null,
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

  it('calls bookingService.deleteShiftTemplate and updates local db with removedAt when deleting', async () => {
    templates = [
      {
        id: 't-delete',
        clinicId: 'c1',
        name: 'Obsolete Shift',
        startMinute: 540,
        endMinute: 780,
        breakDurationMinutes: 0,
        defaultBreakStartMinute: null,
        active: false,
        updatedAt: '',
      },
    ];
    deleteShiftTemplate.mockResolvedValueOnce(undefined);
    dbUpdate.mockResolvedValueOnce(1);
    vi.mocked(askConfirm).mockResolvedValueOnce(true);

    render(<ShiftTemplatesSection />);
    // Template is inactive, expand inactive section first
    fireEvent.click(screen.getByRole('button', { name: /Show inactive templates/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await vi.waitFor(() => {
      expect(deleteShiftTemplate).toHaveBeenCalledWith('t-delete');
      expect(dbUpdate).toHaveBeenCalledWith('t-delete', expect.objectContaining({
        active: false,
        removedAt: expect.any(String),
      }));
    });
  });
});

describe('ShiftTemplatesSection dual-mode editor', () => {
  const open = () => {
    templates = [];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Add shift template/i }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Morning Shift/i), { target: { value: 'Evening split' } });
  };

  it('a continuous shift shows its working time and saves its lunch', () => {
    open();
    expect(screen.getByTestId('shift-badge')).toHaveTextContent('7h working');
    fireEvent.click(screen.getByRole('button', { name: /create shift template/i }));
    expect(createShiftTemplate).toHaveBeenCalledWith({
      clinicId: 'c1', name: 'Evening split', startMinute: 540, endMinute: 1020, breakDurationMinutes: 60, defaultBreakStartMinute: 780,
    });
  });

  it('Split saves session 1 start, session 2 end, and the gap as the break', () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Split' }));
    fireEvent.change(screen.getByLabelText('Session 1 starts'), { target: { value: '08:30' } });
    fireEvent.change(screen.getByLabelText('Session 1 ends'), { target: { value: '13:00' } });
    fireEvent.change(screen.getByLabelText('Session 2 starts'), { target: { value: '16:30' } });
    fireEvent.change(screen.getByLabelText('Session 2 ends'), { target: { value: '20:30' } });
    expect(screen.getByTestId('shift-badge')).toHaveTextContent('8h 30m working · 3h 30m gap');
    fireEvent.click(screen.getByRole('button', { name: /create shift template/i }));
    expect(createShiftTemplate).toHaveBeenCalledWith({
      clinicId: 'c1', name: 'Evening split', startMinute: 510, endMinute: 1230, breakDurationMinutes: 210, defaultBreakStartMinute: 780,
    });
  });

  it('Split refuses a gap under 2 hours and says where to go instead', () => {
    open();
    fireEvent.click(screen.getByRole('radio', { name: 'Split' }));
    fireEvent.change(screen.getByLabelText('Session 1 ends'), { target: { value: '13:00' } });
    fireEvent.change(screen.getByLabelText('Session 2 starts'), { target: { value: '14:00' } });
    expect(screen.getAllByText('For breaks under 2 hours, use Continuous shift with a break.').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /create shift template/i })).toBeDisabled();
  });

  it('opens an existing split template in Split mode with its sessions', () => {
    templates = [
      { id: 't-split', clinicId: 'c1', name: 'Split Shift', startMinute: 540, endMinute: 1200, breakDurationMinutes: 180, defaultBreakStartMinute: 780, active: true, updatedAt: '' },
    ];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('radio', { name: 'Split' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Session 1 ends')).toHaveValue('13:00');
    expect(screen.getByLabelText('Session 2 starts')).toHaveValue('16:00');
  });

  it('offers the three suggested shifts to a clinic with none, and adds them', async () => {
    templates = [];
    render(<ShiftTemplatesSection />);
    expect(screen.getByText(/Morning: 8:30 AM – 1:00 PM & Evening: 4:30 PM – 8:30 PM/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add suggested shifts' }));
    await vi.waitFor(() => expect(createShiftTemplate).toHaveBeenCalledTimes(3));
    expect(createShiftTemplate.mock.calls.map((c) => (c[0] as { name: string }).name)).toEqual(['Morning', 'Evening', 'Split']);
  });

  it('does not offer them once the clinic has had any shift, even an inactive one', () => {
    templates = [{ id: 'old', clinicId: 'c1', name: 'Old', startMinute: 540, endMinute: 780, breakDurationMinutes: 0, defaultBreakStartMinute: null, active: false, updatedAt: '' }];
    render(<ShiftTemplatesSection />);
    expect(screen.queryByRole('button', { name: 'Add suggested shifts' })).toBeNull();
  });

  it('does not offer them on a one-login plan', () => {
    plan.maxMembers = 1;
    try {
      templates = [];
      render(<ShiftTemplatesSection />);
      expect(screen.queryByRole('button', { name: 'Add suggested shifts' })).toBeNull();
    } finally {
      plan.maxMembers = 5;
    }
  });
});
