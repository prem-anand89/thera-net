// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, search }: { children: React.ReactNode; to: string; search?: Record<string, unknown> }) => (
    <a href={to} data-search={JSON.stringify(search)}>
      {children}
    </a>
  ),
}));

let hasTherapist = false;
let visitLogged = false;
let loading = false;
vi.mock('@/features/setup/useSetupProgress', () => ({
  useSetupProgress: () => (loading ? undefined : { signals: { hasTherapist, servicesPriced: false, visitLogged } }),
}));

import { FirstRunCards } from './FirstRunCards';

afterEach(() => {
  cleanup();
  hasTherapist = false;
  visitLogged = false;
  loading = false;
});

describe('FirstRunCards', () => {
  it('no therapist shows the prompt with a button to Settings, Team', () => {
    render(<FirstRunCards clinicId="c1" isAdmin />);
    expect(screen.getByText('Add a therapist to start logging visits')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Add a therapist' });
    expect(link).toHaveAttribute('href', '/settings');
    expect(JSON.parse(link.getAttribute('data-search')!)).toMatchObject({ tab: 'team', teamView: 'members' });
  });

  it('is hidden once a therapist exists', () => {
    hasTherapist = true;
    render(<FirstRunCards clinicId="c1" isAdmin />);
    expect(screen.queryByText('Add a therapist to start logging visits')).not.toBeInTheDocument();
  });

  it('a therapist and no visit yet shows the first-visit card linking to New Visit', () => {
    hasTherapist = true;
    render(<FirstRunCards clinicId="c1" isAdmin />);
    expect(screen.getByText(/Log your first visit/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Log first visit' })).toHaveAttribute('href', '/visits/new');
  });

  it('the first-visit card is gone once a visit is logged, and is admin-only', () => {
    hasTherapist = true;
    visitLogged = true;
    render(<FirstRunCards clinicId="c1" isAdmin />);
    expect(screen.queryByRole('link', { name: 'Log first visit' })).not.toBeInTheDocument();
    cleanup();
    visitLogged = false;
    render(<FirstRunCards clinicId="c1" isAdmin={false} />);
    expect(screen.queryByRole('link', { name: 'Log first visit' })).not.toBeInTheDocument();
  });

  it('is hidden for a non-admin and while loading', () => {
    render(<FirstRunCards clinicId="c1" isAdmin={false} />);
    expect(screen.queryByText('Add a therapist to start logging visits')).not.toBeInTheDocument();
    cleanup();
    loading = true;
    render(<FirstRunCards clinicId="c1" isAdmin />);
    expect(screen.queryByText('Add a therapist to start logging visits')).not.toBeInTheDocument();
  });
});
