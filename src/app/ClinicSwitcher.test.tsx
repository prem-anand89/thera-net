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

  it('is a static label for a non-admin with one clinic', () => {
    render(<ClinicSwitcher clinic={clinic('a', 'Apex Physio')} clinics={[clinic('a', 'Apex Physio')]} logoUrl={null} isAdmin={false} />);
    expect(screen.getByText('Apex Physio')).toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('lets an admin add a clinic even with one clinic', () => {
    render(<ClinicSwitcher clinic={clinic('a', 'Apex Physio')} clinics={[clinic('a', 'Apex Physio')]} logoUrl={null} isAdmin />);
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
