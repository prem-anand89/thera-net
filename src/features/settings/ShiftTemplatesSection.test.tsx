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

const tpl = (over: Partial<ShiftTemplate> = {}): ShiftTemplate => ({
  id: 't1', clinicId: 'c1', name: 'Morning', startMinute: 540, endMinute: 780,
  breakDurationMinutes: 0, defaultBreakStartMinute: null, active: true, updatedAt: '', ...over,
});
const onShift = (templateId: string): TherapistShiftAssignment => ({
  id: 'a1', clinicId: 'c1', therapistId: 'th1', shiftTemplateId: templateId, customHours: null, weekdays: [1, 2],
  breakStartMinute: null, status: 'approved', note: null, decisionNote: null, requestedBy: null, decidedBy: null,
  decidedAt: null, createdAt: '', updatedAt: '',
}) as TherapistShiftAssignment;

describe('ShiftTemplatesSection — Shift types card', () => {
  it('lists the types with their hours, break and who uses them', () => {
    templates = [tpl({ breakDurationMinutes: 30, defaultBreakStartMinute: 660 }), tpl({ id: 't2', name: 'Spare' })];
    therapists = [{ id: 'th1', clinicId: 'c1', name: 'Dr Prem', active: true, updatedAt: '' } as Therapist];
    assignments = [onShift('t1')];
    render(<ShiftTemplatesSection />);
    expect(screen.getByRole('heading', { name: 'Shift types' })).toBeInTheDocument();
    expect(screen.getByText(/9:00 AM – 1:00 PM · 30-min break/)).toBeInTheDocument();
    expect(screen.getByText('Used by Dr Prem')).toBeInTheDocument();
    expect(screen.getByText('Not used yet')).toBeInTheDocument();
  });

  it('shows a split shift as morning and evening ranges', () => {
    templates = [tpl({ id: 's', name: 'Split', endMinute: 1200, breakDurationMinutes: 180, defaultBreakStartMinute: 780 })];
    render(<ShiftTemplatesSection />);
    expect(screen.getByText(/Morning: 9:00 AM – 1:00 PM & Evening: 4:00 PM – 8:00 PM/)).toBeInTheDocument();
  });

  it('warns in the edit sheet when people are on the type', () => {
    templates = [tpl()];
    therapists = [{ id: 'th1', clinicId: 'c1', name: 'Dr Prem', active: true, updatedAt: '' } as Therapist];
    assignments = [onShift('t1')];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Morning' }));
    expect(screen.getByRole('dialog', { name: 'Edit shift type' })).toBeInTheDocument();
    expect(screen.getByText(/Dr Prem is on this shift. Changing the times changes their hours straight away/)).toBeInTheDocument();
  });

  it('adds a type from "+ Add" in a sheet', () => {
    templates = [];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    expect(screen.getByRole('dialog', { name: 'Add a shift type' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Morning, Evening/i), { target: { value: 'Evening' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(createShiftTemplate).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'c1', name: 'Evening' }));
  });

  it('refuses a name that is already a type (capitals ignored) and says so', () => {
    templates = [tpl()];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Morning, Evening/i), { target: { value: 'morning' } });
    expect(screen.getByText('You already have Morning.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('a name that matches a hidden type offers to show it again instead', async () => {
    templates = [tpl({ id: 'old', name: 'Night', active: false })];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Morning, Evening/i), { target: { value: 'Night' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make it active again' }));
    await vi.waitFor(() => expect(updateShiftTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateId: 'old', active: true })));
    expect(createShiftTemplate).not.toHaveBeenCalled();
  });

  it('hides a type from its sheet', () => {
    templates = [tpl()];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Morning' }));
    expect(screen.getByText(/Anyone on it keeps their hours until you change them/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Make inactive' }));
    expect(updateShiftTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateId: 't1', active: false }));
  });

  it('keeps inactive types in an Inactive footer, and makes one active again', () => {
    templates = [tpl({ id: 'old', name: 'Old Shift', active: false })];
    render(<ShiftTemplatesSection />);
    expect(screen.queryByText('Old Shift')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Inactive/ }));
    expect(screen.getByText('Old Shift')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Old Shift' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make active' }));
    expect(updateShiftTemplate).toHaveBeenCalledWith(expect.objectContaining({ templateId: 'old', active: true }));
  });

  it('shows an error in the sheet when adding fails', async () => {
    templates = [];
    createShiftTemplate.mockRejectedValueOnce(new Error('Could not create shift template: boom'));
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Morning, Evening/i), { target: { value: 'Evening' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });

  it('shows an error when hiding fails', async () => {
    templates = [tpl()];
    updateShiftTemplate.mockRejectedValueOnce(new Error('offline'));
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Morning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Make inactive' }));
    expect(await screen.findByText('offline')).toBeInTheDocument();
  });

  it('shows an error when saving an edit fails', async () => {
    templates = [tpl()];
    updateShiftTemplate.mockRejectedValueOnce(new Error('bad bounds'));
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Morning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('bad bounds')).toBeInTheDocument();
  });

  it('deletes an unused type: service call, then the local row is marked removed', async () => {
    templates = [tpl({ id: 't-delete', name: 'Obsolete Shift' })];
    deleteShiftTemplate.mockResolvedValueOnce(undefined);
    dbUpdate.mockResolvedValueOnce(1);
    vi.mocked(askConfirm).mockResolvedValueOnce(true);
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Obsolete Shift' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this shift type' }));
    await vi.waitFor(() => {
      expect(deleteShiftTemplate).toHaveBeenCalledWith('t-delete');
      expect(dbUpdate).toHaveBeenCalledWith('t-delete', expect.objectContaining({ active: false, removedAt: expect.any(String) }));
    });
  });

  it('will not delete a type people are on, and says to hide it instead', async () => {
    templates = [tpl()];
    therapists = [{ id: 'th1', clinicId: 'c1', name: 'Dr Prem', active: true, updatedAt: '' } as Therapist];
    assignments = [onShift('t1')];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Morning' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete this shift type' }));
    expect(await screen.findByText(/Can't delete while Dr Prem is on it/)).toBeInTheDocument();
    expect(deleteShiftTemplate).not.toHaveBeenCalled();
  });

  it('uses CSS variables for chip colours (no hex in the palette)', async () => {
    const { SHIFT_PALETTES } = await import('./shiftUtils');
    expect(SHIFT_PALETTES).toHaveLength(8);
    for (const p of SHIFT_PALETTES) expect(`${p.bg}${p.text}${p.border}`).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(new Set(SHIFT_PALETTES.map((p) => p.bg)).size).toBe(8);
  });
});

describe('ShiftTemplatesSection — one-therapist clinics', () => {
  const solo = () => {
    therapists = [{ id: 'th1', clinicId: 'c1', name: 'Dr Prem', active: true, updatedAt: '' } as Therapist];
  };
  it('is not shown to a one-therapist clinic that has no shift types', () => {
    solo();
    templates = [];
    render(<ShiftTemplatesSection />);
    expect(screen.queryByRole('heading', { name: 'Shift types' })).toBeNull();
  });
  it('is still shown when that clinic already has a shift type', () => {
    solo();
    templates = [tpl()];
    render(<ShiftTemplatesSection />);
    expect(screen.getByRole('heading', { name: 'Shift types' })).toBeInTheDocument();
  });
});

describe('ShiftTemplatesSection dual-mode editor', () => {
  const open = () => {
    templates = [];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: '+ Add' }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Morning, Evening/i), { target: { value: 'Evening split' } });
  };
  const add = () => fireEvent.click(screen.getByRole('button', { name: 'Add' }));

  it('a continuous shift shows its working time and saves its lunch', () => {
    open();
    expect(screen.getByTestId('shift-badge')).toHaveTextContent('7h working');
    add();
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
    add();
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
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('opens an existing split type in Split mode with its sessions', () => {
    templates = [tpl({ id: 't-split', name: 'Split Shift', endMinute: 1200, breakDurationMinutes: 180, defaultBreakStartMinute: 780 })];
    render(<ShiftTemplatesSection />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Split Shift' }));
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

  it('does not offer them once the clinic has had any shift, even a hidden one', () => {
    templates = [tpl({ id: 'old', name: 'Old', active: false })];
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
