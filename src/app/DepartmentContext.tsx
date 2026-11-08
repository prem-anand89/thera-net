import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db';
import type { Clinic } from '@/domain/types';
import { canSwitchDepartment, resolveDepartment, visibleDepartments, type Department } from '@/domain/departments';

export interface DepartmentState {
  /** The department the whole app is showing now. Every list, total and card is scoped to it. */
  department: Department;
  /** The departments this person can open. One means no switch is shown. */
  departments: Department[];
  canSwitch: boolean;
  setDepartment: (next: Department) => void;
}

/** Outside a provider (print views, tests) the app is a one-department OP clinic: nothing to switch, nothing hidden. */
const NONE: DepartmentState = { department: 'clinic', departments: ['clinic'], canSwitch: false, setDepartment: () => undefined };
const DepartmentContext = createContext<DepartmentState>(NONE);

/** The current department and the switch for it. Safe anywhere: without a provider it reads as plain OP. */
export function useDepartment(): DepartmentState {
  return useContext(DepartmentContext);
}

const metaKey = (clinicId: string, userId: string) => `department:${clinicId}:${userId}`;

/**
 * One department at a time, app-wide (like the clinic switcher): the choice is remembered per person and clinic on this
 * device. Someone with one department has no choice, and someone who loses access to the remembered one lands on the
 * first they can still open. The department decides the place of care; no screen shows another department's records.
 */
export function DepartmentProvider({
  clinic,
  userId,
  role,
  departments,
  children,
}: {
  clinic: Clinic | null | undefined;
  userId: string | null | undefined;
  role: string;
  /** `clinic_members.departments` for this login; null = no restriction. */
  departments: readonly string[] | null | undefined;
  children: ReactNode;
}) {
  const key = clinic && userId ? metaKey(clinic.id, userId) : null;
  const remembered = useLiveQuery(async () => (key ? ((await db.meta.get(key))?.value ?? null) : null), [key]);
  const visible = useMemo(() => visibleDepartments(clinic, { role, departments }), [clinic, role, departments]);
  const department = resolveDepartment(visible, remembered);
  const setDepartment = useCallback(
    (next: Department) => {
      if (!key || !visible.includes(next)) return;
      void db.meta.put({ key, value: next });
    },
    [key, visible]
  );
  const value = useMemo<DepartmentState>(
    () => ({ department, departments: visible, canSwitch: canSwitchDepartment(visible), setDepartment }),
    [department, visible, setDepartment]
  );
  return <DepartmentContext.Provider value={value}>{children}</DepartmentContext.Provider>;
}
