// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { buildSetupSteps, summarizeSetup, type SetupSignals } from '@/domain/setupGuide';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1', name: 'Physio Clinic' }) }));
let canEditSettings = true;
vi.mock('@/app/usePermissions', () => ({ usePermissions: () => ({ canEditSettings }) }));

const setManualDone = vi.fn().mockResolvedValue(undefined);
const signals: SetupSignals = {
  clinicProfileSet: true,
  servicesPriced: true,
  teamInvited: true,
  therapistsLinked: true,
  visitLogged: true,
  backedUp: false,
  unlinkedTherapistCount: 0,
  catalogEmpty: false,
};
vi.mock('./useSetupProgress', () => ({
  useSetupProgress: () => ({
    ...summarizeSetup(buildSetupSteps(false, true), signals, new Set()),
    nudgeVisible: false,
    setManualDone,
  }),
}));

import { SetupPage } from './SetupPage';

afterEach(() => {
  cleanup();
  setManualDone.mockClear();
  canEditSettings = true;
});

describe('SetupPage', () => {
  it('shows progress and marks the first unfinished step as next', () => {
    render(<SetupPage />);
    expect(screen.getByText('5 of 8 done')).toBeInTheDocument();
    expect(screen.getByText('Next: Wait for Synced before invoicing')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Essentials' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your first week' })).toBeInTheDocument();
  });

  it('lets an admin tick a manual step', () => {
    render(<SetupPage />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Mark done' })[0]);
    expect(setManualDone).toHaveBeenCalledWith('wait-synced', true);
  });

  it('tells non-admins setup is done by the admin', () => {
    canEditSettings = false;
    render(<SetupPage />);
    expect(screen.getByText('Clinic setup is done by your clinic admin.')).toBeInTheDocument();
  });
});
