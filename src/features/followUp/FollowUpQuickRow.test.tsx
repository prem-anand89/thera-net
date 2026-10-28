// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Patient } from '@/domain/types';
import { followUpDateFor } from '@/domain/followUp';
import { toLocalDateStr } from '@/domain/schedule';

const { setFollowUp, state } = vi.hoisted(() => ({ setFollowUp: vi.fn().mockResolvedValue({}), state: { patient: undefined as Patient | undefined } }));
vi.mock('@/services', () => ({ patientService: { setFollowUp }, repos: { patients: { get: vi.fn() } } }));
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => state.patient }));
vi.mock('./FollowUpDialog', () => ({ FollowUpDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog">dialog</div> : null) }));

import { FollowUpQuickRow } from './FollowUpQuickRow';

const base: Patient = { id: 'p1', clinicId: 'c', mrno: '1', mrnoSource: 'hospital', name: 'Kavin', age: null, sex: null, phone: null, primaryCondition: null, updatedAt: '' };

describe('FollowUpQuickRow', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('one tap on a preset sets the review for the visit therapist', async () => {
    state.patient = base;
    render(<FollowUpQuickRow patientId="p1" therapistId="t1" />);
    fireEvent.click(screen.getByRole('button', { name: '3 days' }));
    await waitFor(() => expect(setFollowUp).toHaveBeenCalledWith('p1', { on: followUpDateFor('3d', toLocalDateStr(new Date())), therapistId: 't1' }));
  });

  it('shows what is set, with Change, instead of the chips', () => {
    state.patient = { ...base, followUpOn: '2026-10-30', followUpNote: 'reassess knee' };
    render(<FollowUpQuickRow patientId="p1" therapistId="t1" />);
    expect(screen.getByText(/Review set for/)).toBeInTheDocument();
    expect(screen.getByText(/reassess knee/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '3 days' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('Pick a date opens the dialog', () => {
    state.patient = base;
    render(<FollowUpQuickRow patientId="p1" therapistId="t1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Pick a date…' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});
