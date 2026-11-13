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

import { NoTherapistsNotice } from './NoTherapistsNotice';

afterEach(cleanup);

describe('NoTherapistsNotice', () => {
  it('says No therapists yet with a link to Settings, Team for an admin', () => {
    render(<NoTherapistsNotice canManage />);
    expect(screen.getByText('No therapists yet')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Add a therapist' });
    expect(link).toHaveAttribute('href', '/settings');
    expect(JSON.parse(link.getAttribute('data-search')!)).toMatchObject({ tab: 'team', teamView: 'members' });
  });

  it('offers no link to someone who cannot manage the team', () => {
    render(<NoTherapistsNotice canManage={false} />);
    expect(screen.getByText('No therapists yet')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
