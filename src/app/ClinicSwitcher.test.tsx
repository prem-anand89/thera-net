// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Clinic } from '@/domain/types';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { meta: { put: vi.fn() } } }));
vi.mock('@/sync/engine', () => ({ syncEngine: { schedule: vi.fn() } }));
vi.mock('@/components/AddClinicDialog', () => ({ AddClinicDialog: () => <div>Add clinic dialog</div> }));

import { ClinicSwitcher } from './ClinicSwitcher';

const clinic = (id: string, name: string) => ({ id, name }) as Clinic;

describe('ClinicSwitcher (header clinic pill)', () => {
  afterEach(cleanup);

  it('is a static pill with first word and initials when there is only one clinic (including admins)', () => {
    render(<ClinicSwitcher clinic={clinic('a', 'Apex Physio')} clinics={[clinic('a', 'Apex Physio')]} logoUrl={null} isAdmin={false} />);
    expect(screen.getByText('Apex')).toBeInTheDocument();
    expect(screen.queryByText('Apex Physio')).not.toBeInTheDocument();
    expect(screen.getByText('AP')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    cleanup();
    render(<ClinicSwitcher clinic={clinic('a', 'Physio Clinic')} clinics={[clinic('a', 'Physio Clinic')]} logoUrl={null} isAdmin />);
    expect(screen.getByText('Physio')).toBeInTheDocument();
    expect(screen.getByText('PC')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('offers Add another clinic inside the dropdown when an admin has multiple clinics', () => {
    const clinics = [clinic('a', 'Apex Physio'), clinic('b', 'Bay Rehab')];
    render(<ClinicSwitcher clinic={clinics[0]} clinics={clinics} logoUrl={null} isAdmin />);
    fireEvent.click(screen.getByRole('button', { name: /Clinic: Apex Physio/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Add another clinic/ }));
    expect(screen.getByText('Add clinic dialog')).toBeInTheDocument();
  });

  it('switches between clinics without offering Add to a non-admin', () => {
    const clinics = [clinic('a', 'Apex Physio'), clinic('b', 'Bay Rehab')];
    render(<ClinicSwitcher clinic={clinics[0]} clinics={clinics} logoUrl="https://x/logo.png" isAdmin={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Switch clinic/ }));
    expect(screen.getByRole('menuitemradio', { name: /Apex Physio/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /Bay Rehab/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Add another clinic/ })).not.toBeInTheDocument();
  });
});
