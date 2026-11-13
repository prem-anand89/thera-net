// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

let mailto: string | null = null;
vi.mock('@/lib/support', () => ({ upgradeMailto: () => mailto }));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => null, publicTherapistPhotoUrl: () => null, publicLogoUrl: () => null }));

import { LockedInviteRow, showLockedInvite } from './TeamSection';

afterEach(() => {
  cleanup();
  mailto = null;
});

describe('locked invite row on one-login plans', () => {
  it('shows the locked row with an upgrade link when a support address is set', () => {
    mailto = 'mailto:help@example.com?subject=Upgrade';
    render(<LockedInviteRow clinicName="Apex" tierLabel="Solo" clinicId="c1" />);
    expect(screen.getByText('Invite a colleague with their own login')).toBeInTheDocument();
    expect(screen.getByText(/Available on Clinic and Clinic\+/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ask to upgrade' })).toHaveAttribute('href', mailto);
  });

  it('says Contact us to upgrade when there is no support address', () => {
    render(<LockedInviteRow clinicName="Apex" tierLabel="Lite" clinicId="c1" />);
    expect(screen.getByText('Contact us to upgrade')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('is wanted on a one-login plan only, and only when plans are enforced', () => {
    expect(showLockedInvite({ enforcementEnabled: true, loading: false, maxMembers: 1 })).toBe(true);
    expect(showLockedInvite({ enforcementEnabled: true, loading: false, maxMembers: 5 })).toBe(false);
    expect(showLockedInvite({ enforcementEnabled: false, loading: false, maxMembers: 1 })).toBe(false);
    expect(showLockedInvite({ enforcementEnabled: true, loading: true, maxMembers: 1 })).toBe(false);
  });
});
