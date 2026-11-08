// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Patient } from '@/domain/types';

const data = vi.hoisted(() => ({ patients: [] as unknown[] }));
const create = vi.hoisted(() => vi.fn());
const askConfirm = vi.hoisted(() => vi.fn());
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c1', name: 'Clinic' }) }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: (q: () => unknown) => q() }));
vi.mock('@/components/usePatientDirectory', () => ({ usePatientDirectory: () => ({ lastVisitOn: new Map() }) }));
vi.mock('@/lib/unsavedWork', () => ({ useUnsavedWorkProbe: () => {} }));
vi.mock('@/lib/notify', () => ({ askConfirm: (...a: unknown[]) => askConfirm(...a), notify: { error: vi.fn(), info: vi.fn() } }));
vi.mock('@/services', () => ({
  repos: { referringSourceCatalog: { list: () => [] }, patients: { list: () => data.patients } },
  patientService: { create: (...a: unknown[]) => create(...a) },
}));

import { AddPatientSheet } from './AddPatientSheet';

const made = { id: 'p9', name: 'Meera', mrno: 'W26-0009' } as Patient;
const setup = (props: Partial<React.ComponentProps<typeof AddPatientSheet>> = {}) => {
  const onCreated = vi.fn();
  const onUseExisting = vi.fn();
  const onClose = vi.fn();
  render(<AddPatientSheet open onClose={onClose} onCreated={onCreated} onUseExisting={onUseExisting} {...props} />);
  return { onCreated, onUseExisting, onClose };
};
const typeName = (v: string) => fireEvent.change(screen.getByPlaceholderText('Patient name'), { target: { value: v } });

beforeEach(() => {
  data.patients = [];
  create.mockReset().mockResolvedValue(made);
  askConfirm.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);

describe('AddPatientSheet', () => {
  it('renders nothing while closed', () => {
    render(<AddPatientSheet open={false} onClose={() => {}} onCreated={() => {}} onUseExisting={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens with the name and phone it was given (an appointment for someone not on file)', () => {
    setup({ initialName: 'Meera', initialPhone: '+91 9820000002' });
    expect(screen.getByPlaceholderText('Patient name')).toHaveValue('Meera');
  });

  it('asks for a name, and saves nothing without one', async () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
    expect(await screen.findByText(/Enter the patient/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('Add patient saves and reports the patient without starting a visit', async () => {
    const { onCreated } = setup();
    typeName('Meera');
    fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(made, { startVisit: false }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ clinicId: 'c1', name: 'Meera' }));
  });

  it('Cancel closes the sheet without creating a patient', async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('a look-alike must be answered before saving, and Use this patient hands back the existing record', async () => {
    data.patients = [{ id: 'p1', clinicId: 'c1', name: 'Meera Rao', mrno: 'H-1', phone: '+91 9820000002', deletedAt: null }];
    const { onUseExisting, onCreated } = setup({ initialName: 'Meera Rao', initialPhone: '+91 9820000002' });
    fireEvent.click(screen.getByRole('button', { name: 'Add patient' }));
    expect(await screen.findByText(/may already be on file/)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Use this patient/ }));
    expect(onUseExisting).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('closing after typing asks first; keeping the edit leaves the sheet open', async () => {
    const { onClose } = setup();
    typeName('Meera');
    askConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(askConfirm).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('closing an untouched sheet needs no question', async () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(askConfirm).not.toHaveBeenCalled();
  });
});
