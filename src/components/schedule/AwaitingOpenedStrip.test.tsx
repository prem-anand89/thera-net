// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { AppointmentRequest } from '@/domain/types';
import { AwaitingOpenedStrip, useAwaitingOpening } from './AwaitingOpenedStrip';

afterEach(cleanup);

const req = (id: string, over: Partial<AppointmentRequest> = {}): AppointmentRequest =>
  ({ id, clinicId: 'c1', name: id, phone: '98', email: null, preferredTherapistId: null, notes: null, preferredDate: '2026-11-06', preferredTimeText: null, status: 'pending', createdAt: `2026-11-0${id.length}T10:00:00Z`, updatedAt: '', ...over }) as AppointmentRequest;

const freedAt = { scheduledAt: new Date(2026, 10, 6, 10, 30).toISOString(), therapistId: 't1' };

describe('useAwaitingOpening', () => {
  it('finds nothing until an appointment is freed, then only the entries that fit', () => {
    const pending = [req('a', { preferredTimeOfDay: 'morning' }), req('bb', { preferredTimeOfDay: 'evening' }), req('ccc', { preferredDate: '2026-11-09' }), req('dddd', { preferredTherapistId: 't2' })];
    const { result } = renderHook(() => useAwaitingOpening(pending));
    expect(result.current.matches).toEqual([]);
    act(() => result.current.freed(freedAt));
    expect(result.current.matches.map((r) => r.id)).toEqual(['a']);
    act(() => result.current.clear());
    expect(result.current.matches).toEqual([]);
  });

  it('shows nothing when nobody fits', () => {
    const { result } = renderHook(() => useAwaitingOpening([req('a', { preferredDate: '2026-11-09' })]));
    act(() => result.current.freed(freedAt));
    expect(result.current.matches).toEqual([]);
  });
});

describe('AwaitingOpenedStrip', () => {
  it('names one person, or counts several, and Book goes to the oldest', () => {
    const onBook = vi.fn();
    const onDismiss = vi.fn();
    const { rerender } = render(<AwaitingOpenedStrip matches={[req('Suresh')]} onBook={onBook} onDismiss={onDismiss} />);
    expect(screen.getByRole('status')).toHaveTextContent('Suresh is awaiting this time.');
    rerender(<AwaitingOpenedStrip matches={[req('Suresh'), req('Meera')]} onBook={onBook} onDismiss={onDismiss} />);
    expect(screen.getByRole('status')).toHaveTextContent('2 people are awaiting this time.');
    fireEvent.click(screen.getByRole('button', { name: 'Book Suresh' }));
    expect(onBook).toHaveBeenCalledWith(expect.objectContaining({ id: 'Suresh' }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('renders nothing for no matches', () => {
    render(<AwaitingOpenedStrip matches={[]} onBook={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
