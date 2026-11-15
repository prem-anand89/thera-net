// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { HepPage } from './HepPage';
import { validateHepSearch } from './hepSearch';

const navigate = vi.fn();
let search: Record<string, unknown> = {};
let perms = { canUseExercises: true, role: 'therapist' };
vi.mock('@tanstack/react-router', () => ({
  useSearch: () => search,
  useNavigate: () => navigate,
  Navigate: ({ to }: { to: string }) => <div>redirected to {to}</div>,
}));
vi.mock('@/app/usePermissions', () => ({ usePermissions: () => perms }));
vi.mock('./LibraryTab', () => ({ LibraryTab: () => <div>library tab</div> }));
vi.mock('./StarterSetSheet', () => ({ StarterSetSheet: () => null }));
vi.mock('./ProgramSheet', () => ({ ProgramSheet: () => null }));
vi.mock('./MessagePatientSheet', () => ({ MessagePatientSheet: () => null }));
afterEach(() => { cleanup(); navigate.mockReset(); search = {}; perms = { canUseExercises: true, role: 'therapist' }; });

describe('HepPage', () => {
  it('front desk never reaches HEP: they are sent back to Workspace', () => {
    perms = { canUseExercises: false, role: 'front_desk' };
    render(<HepPage />);
    expect(screen.getByText('redirected to /workspace')).toBeInTheDocument();
    expect(screen.queryByText('library tab')).toBeNull();
  });

  it('waits while the role is still unknown instead of sending anyone away', () => {
    perms = { canUseExercises: false, role: 'unknown' };
    render(<HepPage />);
    expect(screen.queryByText(/redirected/)).toBeNull();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('opens on the Library and moves between the three tabs through the URL', async () => {
    const user = userEvent.setup();
    render(<HepPage />);
    expect(screen.getByRole('tab', { name: 'Library' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('library tab')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Programs' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/hep', search: { tab: 'programs' } });
  });

  it('keeps only a known tab in the search', () => {
    expect(validateHepSearch({ tab: 'templates' })).toEqual({ tab: 'templates' });
    expect(validateHepSearch({ tab: 'nonsense' })).toEqual({});
    expect(validateHepSearch({ tab: 3 })).toEqual({});
  });
});
