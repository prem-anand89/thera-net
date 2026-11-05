// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const add = vi.hoisted(() => vi.fn());
vi.mock('@/services', () => ({ bookingService: { addWaitlistEntry: (p: unknown) => add(p) } }));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => null }));
vi.mock('@/components/usePatientDirectory', () => ({
  usePatientDirectory: () => ({
    patients: [
      { id: 'p1', clinicId: 'c1', mrno: 'BM26-0001', name: 'Suresh Kumar', phone: '9820000001' },
      { id: 'p2', clinicId: 'c1', mrno: 'BM26-0002', name: 'Meera Nair', phone: null },
    ],
    lastVisitOn: new Map(),
    mrnoFor: () => undefined,
  }),
}));

import { AddToWaitlistSheet } from './AddToWaitlistSheet';

beforeEach(() => {
  add.mockResolvedValue('r1');
});
afterEach(() => {
  cleanup();
  add.mockReset();
});

const open = (extra: Partial<React.ComponentProps<typeof AddToWaitlistSheet>> = {}) =>
  render(<AddToWaitlistSheet open clinicId="c1" initialDate="2026-11-05" therapists={[{ id: 't1', name: 'Dr Prem' }]} onClose={vi.fn()} {...extra} />);

describe('AddToWaitlistSheet', () => {
  it('is titled "Add to awaiting" and says it needs a connection', () => {
    open();
    expect(screen.getByRole('dialog')).toHaveAccessibleName('Add to awaiting');
    expect(screen.getByText(/Needs a connection/)).toBeInTheDocument();
  });

  it('choosing an existing patient fills in their phone, and it saves with today as the day', async () => {
    const onAdded = vi.fn();
    const onClose = vi.fn();
    open({ onAdded, onClose });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'sure' } });
    fireEvent.click(within(screen.getByRole('list', { name: 'Matching patients' })).getByRole('button', { name: /Suresh Kumar/ }));
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Suresh Kumar');
    expect(screen.queryByRole('list', { name: 'Matching patients' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add to awaiting' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add.mock.calls[0][0]).toMatchObject({ clinicId: 'c1', name: 'Suresh Kumar', preferredDate: '2026-11-05', preferredTimeOfDay: 'any' });
    expect(String(add.mock.calls[0][0].phone)).toContain('9820000001');
    expect(onAdded).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('says quietly when the number is already awaiting or booked, and still lets them add', async () => {
    const pending = [{ id: 'r', name: 'Suresh', phone: '+91 9820000001', status: 'pending', createdAt: '2026-11-03T10:00:00Z' }] as never;
    open({ pending });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'sure' } });
    fireEvent.click(within(screen.getByRole('list', { name: 'Matching patients' })).getByRole('button', { name: /Suresh Kumar/ }));
    expect(screen.getByRole('note')).toHaveTextContent('Suresh is already awaiting (added 3 Nov).');
    expect(screen.getByRole('note')).toHaveTextContent('You can still add them.');
    fireEvent.click(screen.getByRole('button', { name: 'Add to awaiting' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  });

  it('a name with no phone cannot be added, and says why', async () => {
    open();
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Walk In' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add to awaiting' }));
    expect(await screen.findByText(/phone number is needed/)).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
  });

  it('shows the offline message and stays open when the save fails', async () => {
    add.mockRejectedValue(new TypeError('Failed to fetch'));
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'sure' } });
    fireEvent.click(within(screen.getByRole('list', { name: 'Matching patients' })).getByRole('button', { name: /Suresh Kumar/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to awaiting' }));
    expect(await screen.findByText(/offline/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
