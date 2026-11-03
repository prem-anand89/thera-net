// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ getSupabase: () => null, publicLogoUrl: () => null }));
vi.mock('@/services', () => ({ repos: { clinics: { putLocal: vi.fn(), put: vi.fn() } } }));
vi.mock('@/app/useActiveClinic', () => ({ setActiveClinic: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));

import { CreateClinicForm } from './CreateClinicForm';

afterEach(cleanup);

describe('Sign-up form — email and address', () => {
  it('the email box gives a phone the email keyboard; the address is the same multi-line box as in Settings', () => {
    render(<CreateClinicForm onSuccess={vi.fn()} variant="dialog" />);
    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('inputmode', 'email');
    expect(email).toHaveAttribute('autocapitalize', 'none');
    const address = screen.getByLabelText('Address');
    expect(address.tagName).toBe('TEXTAREA');
    expect(address).toHaveAttribute('autocomplete', 'street-address');
  });
});
