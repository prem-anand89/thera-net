// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { AssignShiftDialog } from './AssignShiftDialog';
import type { Clinic, ShiftTemplate, Therapist, TherapistShiftAssignment } from '@/domain/types';

const assignShift = vi.fn();
const assignCustomHours = vi.fn();

vi.mock('@/lib/errors', () => ({ toFriendlyMessage: (e: Error) => e.message }));

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => ({ id: 'c1', bookingStartHour: 9, bookingEndHour: 18 }),
}));
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: (query: () => unknown) => query(),
}));

vi.mock('@/services', () => ({
  repos: {
    appointments: { listByClinic: () => [] },
  },
  bookingService: {
    assignShift: (...a: unknown[]) => assignShift(...a),
    assignCustomHours: (...a: unknown[]) => assignCustomHours(...a),
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AssignShiftDialog', () => {
  const clinic: Clinic = {
    id: 'c1',
    name: 'Clinic',
    bookingStartHour: 9,
    bookingEndHour: 18,
    closedWeekdays: [0], // Sunday
  } as Clinic;

  const therapists: Therapist[] = [
    { id: 'th1', clinicId: 'c1', name: 'Dr Prem', active: true, updatedAt: '' },
    { id: 'th2', clinicId: 'c1', name: 'Dr Kiran', active: true, updatedAt: '' },
  ];

  const templates: ShiftTemplate[] = [
    {
      id: 't1',
      clinicId: 'c1',
      name: 'Morning Shift',
      startMinute: 540,
      endMinute: 840,
      breakDurationMinutes: 30,
      defaultBreakStartMinute: 660,
      active: true,
      updatedAt: '',
    },
    {
      id: 't2',
      clinicId: 'c1',
      name: 'Evening Shift',
      startMinute: 840,
      endMinute: 1140,
      breakDurationMinutes: 30,
      defaultBreakStartMinute: 960,
      active: true,
      updatedAt: '',
    },
  ];

  it('renders prefilled therapist and submits shift assignment', () => {
    const onClose = vi.fn();
    render(
      <AssignShiftDialog
        isOpen={true}
        onClose={onClose}
        initialTherapistId="th1"
        initialWeekday={1} // Monday
        therapists={therapists}
        templates={templates}
        approvedAssignments={[]}
        pendingAssignments={[]}
        clinic={clinic}
      />
    );

    expect(screen.getByRole('dialog', { name: /Assign shift/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Dr Prem/ })).toBeInTheDocument();

    // Click assign button
    const submitBtn = screen.getByRole('button', { name: 'Assign to 1 therapist' });
    fireEvent.click(submitBtn);

    expect(assignShift).toHaveBeenCalledWith({
      therapistId: 'th1',
      shiftTemplateId: 't1',
      weekdays: [1],
      breakStartMinute: null,
    });
  });

  it('supports selecting "Clinic Default Hours" to reset working hours', () => {
    const onClose = vi.fn();
    render(
      <AssignShiftDialog
        isOpen={true}
        onClose={onClose}
        initialTherapistId="th1"
        therapists={therapists}
        templates={templates}
        approvedAssignments={[]}
        pendingAssignments={[]}
        clinic={clinic}
      />
    );

    // Change dropdown to Clinic Default Hours
    const select = screen.getByRole('combobox');
    fireEvent.change(select, { target: { value: '__clinic_default__' } });

    // Click submit
    const submitBtn = screen.getByRole('button', { name: /Reset 1 therapist to Clinic Default/i });
    fireEvent.click(submitBtn);

    expect(assignCustomHours).toHaveBeenCalledWith('th1', null);
  });

  it('supports quick weekday presets (Open days, Mon-Fri, All days)', () => {
    render(
      <AssignShiftDialog
        isOpen={true}
        onClose={vi.fn()}
        initialTherapistId="th1"
        therapists={therapists}
        templates={templates}
        approvedAssignments={[]}
        pendingAssignments={[]}
        clinic={clinic}
      />
    );

    // Mon-Fri preset
    fireEvent.click(screen.getByRole('button', { name: 'Mon–Fri' }));
    const submitBtn = screen.getByRole('button', { name: 'Assign to 1 therapist' });
    fireEvent.click(submitBtn);

    expect(assignShift).toHaveBeenCalledWith(
      expect.objectContaining({ weekdays: [1, 2, 3, 4, 5] })
    );
  });

  it('pre-fills existing assignment shift template, weekdays, and break start override when clicking a cell', () => {
    const existingAssignment: TherapistShiftAssignment = {
      id: 'a1',
      clinicId: 'c1',
      therapistId: 'th1',
      shiftTemplateId: 't2', // Evening Shift
      customHours: null,
      weekdays: [2, 3, 4], // Tue, Wed, Thu
      breakStartMinute: 960,
      status: 'approved',
      note: null,
      decisionNote: null,
      requestedBy: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: '',
      updatedAt: '',
    };

    render(
      <AssignShiftDialog
        isOpen={true}
        onClose={vi.fn()}
        initialTherapistId="th1"
        initialWeekday={3} // Wednesday
        therapists={therapists}
        templates={templates}
        approvedAssignments={[existingAssignment]}
        pendingAssignments={[]}
        clinic={clinic}
      />
    );

    // Selected shift template should be Evening Shift (t2), not the default t1
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('t2');

    // Click assign button without modifying anything
    const submitBtn = screen.getByRole('button', { name: 'Assign to 1 therapist' });
    fireEvent.click(submitBtn);

    // Should retain t2, weekdays [2, 3, 4], and breakStartMinute 960
    expect(assignShift).toHaveBeenCalledWith({
      therapistId: 'th1',
      shiftTemplateId: 't2',
      weekdays: [2, 3, 4],
      breakStartMinute: 960,
    });
  });

  it('synchronizes breakStartOverride when toggling break override', () => {
    render(
      <AssignShiftDialog
        isOpen={true}
        onClose={vi.fn()}
        initialTherapistId="th1"
        initialWeekday={1}
        therapists={therapists}
        templates={templates}
        approvedAssignments={[]}
        pendingAssignments={[]}
        clinic={clinic}
      />
    );

    // Open break override
    fireEvent.click(screen.getByRole('button', { name: /override default break/i }));

    // Click assign button
    const submitBtn = screen.getByRole('button', { name: 'Assign to 1 therapist' });
    fireEvent.click(submitBtn);

    // Should pass the template's default break minute (660) since override was active
    expect(assignShift).toHaveBeenCalledWith({
      therapistId: 'th1',
      shiftTemplateId: 't1',
      weekdays: [1],
      breakStartMinute: 660,
    });
  });

  it('dynamically loads schedule when toggling between therapists with different schedules', () => {
    const premTherapist: Therapist = {
      id: 'th1',
      clinicId: 'c1',
      name: 'Prem',
      active: true,
      updatedAt: '',
      workingHours: {
        '1': [[540, 780]],
        '3': [[540, 780]],
        '5': [[540, 780]],
      }, // Mon, Wed, Fri
    };

    const kiranTherapist: Therapist = {
      id: 'th2',
      clinicId: 'c1',
      name: 'Kiran',
      active: true,
      updatedAt: '',
    };

    const kiranAssignment: TherapistShiftAssignment = {
      id: 'a2',
      clinicId: 'c1',
      therapistId: 'th2',
      shiftTemplateId: 't2', // Evening Shift
      customHours: null,
      weekdays: [2, 4], // Tue, Thu
      breakStartMinute: null,
      status: 'approved',
      note: null,
      decisionNote: null,
      requestedBy: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: '',
      updatedAt: '',
    };

    render(
      <AssignShiftDialog
        isOpen={true}
        onClose={vi.fn()}
        initialTherapistId={null}
        therapists={[premTherapist, kiranTherapist]}
        templates={templates}
        approvedAssignments={[kiranAssignment]}
        pendingAssignments={[]}
        clinic={clinic}
      />
    );

    // Verify both therapists show their current schedules on their buttons
    expect(screen.getByRole('button', { name: /Prem.*Custom hours/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kiran.*Evening Shift/i })).toBeInTheDocument();

    // 1. Click Prem
    fireEvent.click(screen.getByRole('button', { name: /Prem.*Custom hours/i }));
    // Custom hours banner for Prem is shown
    expect(screen.getByText(/Currently on custom working hours/i)).toBeInTheDocument();

    // 2. Click Kiran to select both
    fireEvent.click(screen.getByRole('button', { name: /Kiran.*Evening Shift/i }));
    // Multi-member banner appears explaining differing schedules
    expect(screen.getByText(/Assigning shift to 2 team members/i)).toBeInTheDocument();
    expect(screen.getByText(/currently Custom hours/i)).toBeInTheDocument();
    expect(screen.getByText(/currently Evening Shift/i)).toBeInTheDocument();

    // 3. Deselect Prem so only Kiran is selected
    fireEvent.click(screen.getByRole('button', { name: /Prem.*Custom hours/i }));
    // Kiran's template t2 should now be loaded into the dropdown
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('t2');
  });

  it('clicking an Off-day cell shows existing schedule context and pre-selects existing days plus clicked day', () => {
    // Prem Anand is assigned to Evening Shift (t2) on Wed(3), Fri(5), Sat(6)
    const existingAssignment: TherapistShiftAssignment = {
      id: 'a-prem',
      clinicId: 'c1',
      therapistId: 'th1',
      shiftTemplateId: 't2',
      customHours: null,
      weekdays: [3, 5, 6],
      breakStartMinute: null,
      status: 'approved',
      note: null,
      decisionNote: null,
      requestedBy: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: '',
      updatedAt: '',
    };

    render(
      <AssignShiftDialog
        isOpen={true}
        onClose={vi.fn()}
        initialTherapistId="th1"
        initialWeekday={2} // Tuesday (currently Off)
        therapists={therapists}
        templates={templates}
        approvedAssignments={[existingAssignment]}
        pendingAssignments={[]}
        clinic={clinic}
      />
    );

    // Context banner should show Current Schedule: Dr Prem, Evening Shift (Wed/Fri/Sat)
    expect(screen.getByText(/Current Schedule: Dr Prem/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Evening Shift \(Wed\/Fri\/Sat\)/i).length).toBeGreaterThanOrEqual(1);

    // Context banner should indicate Tuesday is currently a Day Off
    expect(screen.getByText(/Currently a Day Off \(No shift scheduled\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Adding Tue to active days below/i)).toBeInTheDocument();

    // Shift Schedule dropdown should automatically select Prem's current template (t2)
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('t2');

    // Weekdays should be pre-selected to existing days + Tuesday: [2, 3, 5, 6]
    // Presets "+ Add Tue", "Tue only", "Existing only" should be present
    expect(screen.getByRole('button', { name: '+ Add Tue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tue only' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Existing only' })).toBeInTheDocument();

    // Submitting assigns Tue, Wed, Fri, Sat with template t2
    const submitBtn = screen.getByRole('button', { name: 'Assign to 1 therapist' });
    fireEvent.click(submitBtn);

    expect(assignShift).toHaveBeenCalledWith({
      therapistId: 'th1',
      shiftTemplateId: 't2',
      weekdays: [2, 3, 5, 6],
      breakStartMinute: null,
    });
  });

  it('allows switching to "Tue only" when clicking an Off-day', () => {
    const existingAssignment: TherapistShiftAssignment = {
      id: 'a-prem',
      clinicId: 'c1',
      therapistId: 'th1',
      shiftTemplateId: 't2',
      customHours: null,
      weekdays: [3, 5, 6],
      breakStartMinute: null,
      status: 'approved',
      note: null,
      decisionNote: null,
      requestedBy: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: '',
      updatedAt: '',
    };

    render(
      <AssignShiftDialog
        isOpen={true}
        onClose={vi.fn()}
        initialTherapistId="th1"
        initialWeekday={2} // Tuesday (currently Off)
        therapists={therapists}
        templates={templates}
        approvedAssignments={[existingAssignment]}
        pendingAssignments={[]}
        clinic={clinic}
      />
    );

    // Clicking "Tue only" switches active days to just Tuesday [2]
    fireEvent.click(screen.getByRole('button', { name: 'Tue only' }));

    const submitBtn = screen.getByRole('button', { name: 'Assign to 1 therapist' });
    fireEvent.click(submitBtn);

    expect(assignShift).toHaveBeenCalledWith({
      therapistId: 'th1',
      shiftTemplateId: 't2',
      weekdays: [2],
      breakStartMinute: null,
    });
  });

  it('dynamically updates delta notification and shows −Removed / +Add badges when adding/removing days', () => {
    const existingAssignment: TherapistShiftAssignment = {
      id: 'a-prem',
      clinicId: 'c1',
      therapistId: 'th1',
      shiftTemplateId: 't2',
      customHours: null,
      weekdays: [3, 5, 6], // Wed, Fri, Sat
      breakStartMinute: null,
      status: 'approved',
      note: null,
      decisionNote: null,
      requestedBy: null,
      decidedBy: null,
      decidedAt: null,
      createdAt: '',
      updatedAt: '',
    };

    render(
      <AssignShiftDialog
        isOpen={true}
        onClose={vi.fn()}
        initialTherapistId="th1"
        initialWeekday={1} // Monday
        therapists={therapists}
        templates={templates}
        approvedAssignments={[existingAssignment]}
        pendingAssignments={[]}
        clinic={clinic}
      />
    );

    // Initial state: Mon is added to Wed/Fri/Sat
    expect(screen.getByText(/Adding Mon to active days below/i)).toBeInTheDocument();

    // 1. Toggle Tuesday on: now Mon and Tue are added
    fireEvent.click(screen.getByRole('button', { name: /^Tue/i }));
    expect(screen.getByText(/Adding Mon\/Tue to active days below/i)).toBeInTheDocument();

    // 2. Toggle Wednesday off: removing Wed
    fireEvent.click(screen.getByRole('button', { name: /^Wed/i }));
    expect(screen.getByText(/Removing Wed from schedule/i)).toBeInTheDocument();
    // Wednesday button should show −Removed badge
    expect(screen.getByRole('button', { name: /Wed.*−Removed/i })).toBeInTheDocument();

    // Submitting assigns [1, 2, 5, 6] (Mon, Tue, Fri, Sat)
    const submitBtn = screen.getByRole('button', { name: 'Assign to 1 therapist' });
    fireEvent.click(submitBtn);

    expect(assignShift).toHaveBeenCalledWith({
      therapistId: 'th1',
      shiftTemplateId: 't2',
      weekdays: [1, 2, 5, 6],
      breakStartMinute: null,
    });
  });

  it('supports Clear preset to deselect all days and disables submit', () => {
    render(
      <AssignShiftDialog
        isOpen={true}
        onClose={vi.fn()}
        initialTherapistId="th1"
        initialWeekday={1}
        therapists={therapists}
        templates={templates}
        approvedAssignments={[]}
        pendingAssignments={[]}
        clinic={clinic}
      />
    );

    // Click Clear
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    // Warning appears
    expect(screen.getByText('Please pick at least one working day.')).toBeInTheDocument();

    // Submit button is disabled
    const submitBtn = screen.getByRole('button', { name: 'Assign to 1 therapist' });
    expect(submitBtn).toBeDisabled();
  });

  describe('custom hours option', () => {
    it('disables custom hours option when multiple therapists are selected', () => {
      render(
        <AssignShiftDialog
          isOpen={true}
          onClose={vi.fn()}
          initialTherapistId={null} // Select all or multiple
          therapists={therapists}
          templates={templates}
          approvedAssignments={[]}
          pendingAssignments={[]}
          clinic={clinic}
        />
      );

      // Select both therapists by clicking Dr Prem and Dr Kiran
      fireEvent.click(screen.getByRole('button', { name: /Dr Prem/ }));
      fireEvent.click(screen.getByRole('button', { name: /Dr Kiran/ }));

      const option = screen.getByRole('option', { name: /Custom hours \(select one person\)/i });
      expect(option).toBeDisabled();
    });

    it('enables custom hours option when exactly one therapist is selected', () => {
      render(
        <AssignShiftDialog
          isOpen={true}
          onClose={vi.fn()}
          initialTherapistId="th1"
          therapists={therapists}
          templates={templates}
          approvedAssignments={[]}
          pendingAssignments={[]}
          clinic={clinic}
        />
      );

      const option = screen.getByRole('option', { name: /Custom hours \(individual\)/i });
      expect(option).not.toBeDisabled();
    });

    it('selecting custom hours shows notice, Set custom hours button, and hides weekday checkboxes', () => {
      render(
        <AssignShiftDialog
          isOpen={true}
          onClose={vi.fn()}
          initialTherapistId="th1"
          therapists={therapists}
          templates={templates}
          approvedAssignments={[]}
          pendingAssignments={[]}
          clinic={clinic}
        />
      );

      // Select Custom hours option
      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: '__custom_hours__' } });

      // Notice appears
      expect(
        screen.getByText('Custom hours replace all assigned shifts for Dr Prem.')
      ).toBeInTheDocument();

      // Primary button is "Set custom hours…"
      expect(screen.getByRole('button', { name: 'Set custom hours…' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Assign to/i })).toBeNull();

      // Weekday picker is hidden
      expect(screen.queryByText('Active Weekdays')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Mon' })).toBeNull();
    });
  });
});


