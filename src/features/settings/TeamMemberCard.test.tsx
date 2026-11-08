// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

afterEach(cleanup);
import { TeamMemberCard } from './TeamSection';
import { repos } from '@/services';
import type { Clinic, ShiftTemplate, Therapist, TherapistShiftAssignment } from '@/domain/types';

const memberWrites = vi.hoisted(() => ({ updates: [] as Record<string, unknown>[], client: null as unknown }));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => memberWrites.client,
  publicTherapistPhotoUrl: () => null,
  publicLogoUrl: () => null,
}));

const clinic: Clinic = {
  id: 'c1',
  name: 'Test Clinic',
  bookingStartHour: 9,
  bookingEndHour: 17,
  closedWeekdays: [0], // Sunday closed
  slotDurationMinutes: 30,
} as Clinic;

const generalShift: ShiftTemplate = {
  id: 'tmpl-general',
  clinicId: 'c1',
  name: 'General Shift',
  startMinute: 540,
  endMinute: 960,
  breakDurationMinutes: 60,
  defaultBreakStartMinute: 810,
  active: true,
  updatedAt: '',
};

describe('TeamMemberCard', () => {
  it('shows shift template schedule summary for therapist on General Shift, never Custom schedule', () => {
    const kiranHours: Record<string, [number, number][]> = {
      '1': [[540, 810], [870, 960]],
      '2': [[540, 810], [870, 960]],
      '3': [[540, 810], [870, 960]],
      '4': [[540, 810], [870, 960]],
      '5': [[540, 810], [870, 960]],
      '6': [[540, 810], [870, 960]],
    };
    const therapist: Therapist = {
      id: 'th-kiran',
      clinicId: 'c1',
      name: 'Dr Kiran',
      active: true,
      workingHours: kiranHours,
      updatedAt: '',
    };
    const assignments: TherapistShiftAssignment[] = [
      {
        id: 'a1',
        clinicId: 'c1',
        therapistId: 'th-kiran',
        shiftTemplateId: 'tmpl-general',
        customHours: null,
        weekdays: [1, 2, 3, 4, 5, 6],
        breakStartMinute: 810,
        status: 'approved',
        note: null,
        decisionNote: null,
        requestedBy: null,
        decidedBy: null,
        decidedAt: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ];

    render(
      <TeamMemberCard
        person={{ key: 'p1', therapist, member: null }}
        membersLoaded
        clinicId="c1"
        isLastAdmin={false}
        revoking={false}
        resending={false}
        onRevoke={vi.fn()}
        onResend={vi.fn()}
        onSaved={vi.fn()}
        onDelete={vi.fn()}
        onPhotoUpload={vi.fn()}
        onDeactivate={vi.fn()}
        assignments={assignments}
        templates={[generalShift]}
        clinic={clinic}
      />
    );

    expect(screen.getByText('Mon–Sat 9–1:30 & 2:30–4')).toBeInTheDocument();
    expect(screen.queryByText('Custom schedule')).toBeNull();
  });

  it('shows stored custom hours summary for therapist with only custom hours', () => {
    const therapist: Therapist = {
      id: 'th-custom',
      clinicId: 'c1',
      name: 'Dr Consultant',
      active: true,
      workingHours: {
        '2': [[600, 780]], // Tue 10-1
        '6': [[600, 780]], // Sat 10-1
      },
      updatedAt: '',
    };

    render(
      <TeamMemberCard
        person={{ key: 'p2', therapist, member: null }}
        membersLoaded
        clinicId="c1"
        isLastAdmin={false}
        revoking={false}
        resending={false}
        onRevoke={vi.fn()}
        onResend={vi.fn()}
        onSaved={vi.fn()}
        onDelete={vi.fn()}
        onPhotoUpload={vi.fn()}
        onDeactivate={vi.fn()}
        assignments={[]}
        templates={[]}
        clinic={clinic}
      />
    );

    expect(screen.getByText('Tue, Sat 10–1')).toBeInTheDocument();
    expect(screen.queryByText('Custom schedule')).toBeNull();
  });

  it('shows clinic default summary for therapist with no hours and no assignments', () => {
    const therapist: Therapist = {
      id: 'th-default',
      clinicId: 'c1',
      name: 'Dr Default',
      active: true,
      workingHours: null,
      updatedAt: '',
    };

    render(
      <TeamMemberCard
        person={{ key: 'p3', therapist, member: null }}
        membersLoaded
        clinicId="c1"
        isLastAdmin={false}
        revoking={false}
        resending={false}
        onRevoke={vi.fn()}
        onResend={vi.fn()}
        onSaved={vi.fn()}
        onDelete={vi.fn()}
        onPhotoUpload={vi.fn()}
        onDeactivate={vi.fn()}
        assignments={[]}
        templates={[]}
        clinic={clinic}
      />
    );

    expect(screen.getByText('Mon–Sat 9–5')).toBeInTheDocument();
    expect(screen.queryByText('Custom schedule')).toBeNull();
  });
});

describe('TeamMemberCard — unlinked state while the member list loads', () => {
  const render1 = (therapist: Therapist, membersLoaded: boolean) =>
    render(
      <TeamMemberCard
        person={{ key: 'p', therapist, member: null }}
        membersLoaded={membersLoaded}
        clinicId="c1"
        isLastAdmin={false}
        revoking={false}
        resending={false}
        onRevoke={vi.fn()}
        onResend={vi.fn()}
        onSaved={vi.fn()}
        onDelete={vi.fn()}
        onPhotoUpload={vi.fn()}
        onDeactivate={vi.fn()}
        assignments={[]}
        templates={[]}
        clinic={clinic}
      />
    );
  const linked: Therapist = { id: 't1', clinicId: 'c1', name: 'Dr Linked', active: true, userId: 'u1', updatedAt: '' };
  const unlinked: Therapist = { id: 't2', clinicId: 'c1', name: 'Dr Roster', active: true, userId: null, updatedAt: '' };

  it('shows no "No login" pill or Delete record for a therapist that has a login while members are loading', () => {
    render1(linked, false);
    expect(screen.queryByText('No login')).toBeNull();
    expect(screen.queryByText('Delete record')).toBeNull();
  });

  it('shows both once the member list has loaded and found no login for them', () => {
    render1(linked, true);
    expect(screen.getByText('No login')).toBeInTheDocument();
    expect(screen.getByText('Delete record')).toBeInTheDocument();
  });

  it('still shows them for a roster row with no login at all, even before the list loads', () => {
    render1(unlinked, false);
    expect(screen.getByText('No login')).toBeInTheDocument();
  });
});

describe('TeamMemberCard — Role in the edit form', () => {
  const linked: Therapist = { id: 't1', clinicId: 'c1', name: 'Dr Linked', active: true, userId: 'u1', updatedAt: '' };
  const member = (role: string) => ({
    userId: 'u1',
    email: 'a@b.c',
    role,
    displayName: 'Dr Linked',
    status: 'active',
    invitedAt: null,
    lastSignInAt: null,
    lastActiveAt: null,
  });
  const card = (m: ReturnType<typeof member> | null, membersLoaded: boolean) => (
    <TeamMemberCard
      person={{ key: 'p', therapist: linked, member: m } as never}
      membersLoaded={membersLoaded}
      clinicId="c1"
      isLastAdmin={false}
      revoking={false}
      resending={false}
      onRevoke={vi.fn()}
      onResend={vi.fn()}
      onSaved={vi.fn()}
      onDelete={vi.fn()}
      onPhotoUpload={vi.fn()}
      onDeactivate={vi.fn()}
      assignments={[]}
      templates={[]}
      clinic={clinic}
    />
  );

  beforeEach(() => {
    memberWrites.updates = [];
    memberWrites.client = {
      from: () => ({
        update: (row: Record<string, unknown>) => {
          memberWrites.updates.push(row);
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
      }),
    };
  });
  afterEach(() => {
    memberWrites.client = null;
  });

  const roleBox = () => screen.queryByRole('combobox', { name: 'Role' });

  it('is hidden while the member list loads, then shows the real role, and saving writes no role', async () => {
    const { rerender } = render(card(null, false));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(roleBox()).toBeNull();

    rerender(card(member('admin'), true));
    expect(roleBox()).toHaveValue('admin');

    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(memberWrites.updates).toHaveLength(1));
    expect(memberWrites.updates[0]).not.toHaveProperty('role');
  });

  it('writes the role only when the admin picks a different one', async () => {
    render(card(member('front_desk'), true));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(roleBox()!, { target: { value: 'admin' } });
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(memberWrites.updates).toHaveLength(1));
    expect(memberWrites.updates[0]).toMatchObject({ role: 'admin' });
  });
});

describe('TeamMemberCard — Departments in the edit form (G2)', () => {
  const multiClinic: Clinic = {
    ...clinic,
    careLocations: ['clinic', 'home', 'ward'],
  } as Clinic;

  const linked: Therapist = { id: 't1', clinicId: 'c1', name: 'Dr Linked', active: true, userId: 'u1', updatedAt: '' };
  const member = (role: string, departments?: string[] | null) => ({
    userId: 'u1',
    email: 'a@b.c',
    role,
    displayName: 'Dr Linked',
    departments: departments ?? null,
    status: 'active',
    invitedAt: null,
    lastSignInAt: null,
    lastActiveAt: null,
  });

  const card = (
    c: Clinic,
    m: ReturnType<typeof member> | null,
    t: Therapist | null = linked,
    membersLoaded = true
  ) => (
    <TeamMemberCard
      person={{ key: 'p', therapist: t, member: m } as never}
      membersLoaded={membersLoaded}
      clinicId="c1"
      isLastAdmin={false}
      revoking={false}
      resending={false}
      onRevoke={vi.fn()}
      onResend={vi.fn()}
      onSaved={vi.fn()}
      onDelete={vi.fn()}
      onPhotoUpload={vi.fn()}
      onDeactivate={vi.fn()}
      assignments={[]}
      templates={[]}
      clinic={c}
    />
  );

  let therapistPutSpy: MockInstance;

  beforeEach(() => {
    memberWrites.updates = [];
    memberWrites.client = {
      from: () => ({
        update: (row: Record<string, unknown>) => {
          memberWrites.updates.push(row);
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
      }),
    };
    therapistPutSpy = vi.spyOn(repos.therapists, 'put').mockResolvedValue(undefined);
  });

  afterEach(() => {
    memberWrites.client = null;
    therapistPutSpy.mockRestore();
  });

  it('hides the departments field for a one-department clinic', () => {
    render(card(clinic, member('therapist')));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.queryByText('Departments')).toBeNull();
    expect(screen.queryByText('Works in')).toBeNull();
  });

  it('shows "Works in" for a therapist in a multi-department clinic, and saves a subset of departments', async () => {
    render(card(multiClinic, member('therapist')));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Works in')).toBeInTheDocument();

    const opCheckbox = screen.getByRole('checkbox', { name: 'OP' });
    const homeCheckbox = screen.getByRole('checkbox', { name: 'Home care' });

    fireEvent.click(opCheckbox);
    fireEvent.click(homeCheckbox);

    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(memberWrites.updates).toHaveLength(1));
    expect(memberWrites.updates[0]).toMatchObject({ departments: ['clinic', 'home'] });
    expect(therapistPutSpy).toHaveBeenCalledWith(
      expect.objectContaining({ careLocations: ['clinic', 'home'] })
    );
  });

  it('saves null when all departments are ticked', async () => {
    render(card(multiClinic, member('therapist')));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    const opCheckbox = screen.getByRole('checkbox', { name: 'OP' });
    const homeCheckbox = screen.getByRole('checkbox', { name: 'Home care' });
    const ipCheckbox = screen.getByRole('checkbox', { name: 'IP' });

    fireEvent.click(opCheckbox);
    fireEvent.click(homeCheckbox);
    fireEvent.click(ipCheckbox);

    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(memberWrites.updates).toHaveLength(1));
    expect(memberWrites.updates[0]).toMatchObject({ departments: null });
    expect(therapistPutSpy).toHaveBeenCalledWith(
      expect.objectContaining({ careLocations: null })
    );
  });

  it('saves null when no departments are ticked', async () => {
    render(card(multiClinic, member('therapist')));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));

    // None ticked
    fireEvent.click(screen.getByRole('button', { name: /^Save/ }));
    await waitFor(() => expect(memberWrites.updates).toHaveLength(1));
    expect(memberWrites.updates[0]).toMatchObject({ departments: null });
    expect(therapistPutSpy).toHaveBeenCalledWith(
      expect.objectContaining({ careLocations: null })
    );
  });

  it('shows "Departments" for a non-therapist member (front desk)', () => {
    render(card(multiClinic, member('front_desk'), null));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByText('Departments')).toBeInTheDocument();
    expect(screen.queryByText('Works in')).toBeNull();
  });
});
