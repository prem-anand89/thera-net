// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { db } from '@/lib/db';
import type { Clinic } from '@/domain/types';
import { DepartmentProvider, useDepartment } from './DepartmentContext';

const clinic = { id: 'c1', careLocations: ['clinic', 'home', 'ward'] } as unknown as Clinic;

function Probe() {
  const d = useDepartment();
  return (
    <div>
      <span data-testid="now">{d.department}</span>
      <span data-testid="all">{d.departments.join(',')}</span>
      <span data-testid="switch">{String(d.canSwitch)}</span>
      <button type="button" onClick={() => d.setDepartment('ward')}>to ward</button>
      <button type="button" onClick={() => d.setDepartment('home')}>to home</button>
    </div>
  );
}
const show = (role: string, departments: string[] | null) =>
  render(
    <DepartmentProvider clinic={clinic} userId="u1" role={role} departments={departments}>
      <Probe />
    </DepartmentProvider>
  );

describe('DepartmentProvider', () => {
  beforeEach(async () => {
    await db.meta.clear();
  });
  afterEach(cleanup);

  it('starts on the first department, switches, and remembers the choice', async () => {
    const { unmount } = show('admin', null);
    expect(screen.getByTestId('now')).toHaveTextContent('clinic');
    expect(screen.getByTestId('switch')).toHaveTextContent('true');
    await act(async () => screen.getByText('to ward').click());
    await waitFor(() => expect(screen.getByTestId('now')).toHaveTextContent('ward'));
    unmount();
    show('admin', null);
    await waitFor(() => expect(screen.getByTestId('now')).toHaveTextContent('ward'));
  });

  it('a person with one department has no switch and cannot open another', async () => {
    show('therapist', ['home']);
    expect(screen.getByTestId('all')).toHaveTextContent('home');
    expect(screen.getByTestId('now')).toHaveTextContent('home');
    expect(screen.getByTestId('switch')).toHaveTextContent('false');
    await act(async () => screen.getByText('to ward').click());
    expect(screen.getByTestId('now')).toHaveTextContent('home');
  });

  it('without a provider the app reads as plain OP with nothing to switch', () => {
    render(<Probe />);
    expect(screen.getByTestId('now')).toHaveTextContent('clinic');
    expect(screen.getByTestId('switch')).toHaveTextContent('false');
  });
});
