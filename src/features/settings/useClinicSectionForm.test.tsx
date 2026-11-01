// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import type { Clinic } from '@/domain/types';

// The clinic row as the app sees it: a live value that changes when anything writes it (a sync pull, another admin,
// another card's save). `useClinic` re-renders on every change, like the real Dexie-backed context.
const store = {
  clinic: {} as Partial<Clinic>,
  listeners: new Set<() => void>(),
  set(next: Partial<Clinic>) {
    store.clinic = next;
    store.listeners.forEach((l) => l());
  },
};
vi.mock('@/app/clinicContext', () => ({
  useClinic: () =>
    useSyncExternalStore(
      (l) => {
        store.listeners.add(l);
        return () => store.listeners.delete(l);
      },
      () => store.clinic
    ),
}));
vi.mock('@/services', () => ({
  repos: {
    clinics: {
      get: async () => store.clinic,
      put: async (row: Partial<Clinic>) => store.set(row),
    },
  },
}));

import { SAVED_NOTE_MS, SectionSaveBar, useClinicSectionForm } from './settingsShared';

function NameCard() {
  const { form, set, save, cancel, dirty, saved, busy, error, showSaveBar } = useClinicSectionForm<Pick<Clinic, 'name'>>(
    (c) => ({ name: c.name }),
    () => {}
  );
  return (
    <div>
      <label>
        Clinic name
        <input value={form.name ?? ''} onChange={(e) => set({ name: e.target.value })} />
      </label>
      {showSaveBar && (
        <SectionSaveBar dirty={dirty} saved={saved} busy={busy} onSave={() => void save()} onCancel={cancel} error={error} />
      )}
    </div>
  );
}

beforeEach(() => {
  store.clinic = { id: 'c1', name: 'Physio Clinic', address: '1 Main Road' };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('a Settings card with no Edit button', () => {
  it('is typeable straight away and shows no Save bar until something changes', () => {
    render(<NameCard />);
    expect(screen.getByLabelText('Clinic name')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Clinic name'), { target: { value: 'Physio Clinic Plus' } });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('an untouched card takes new saved values and never shows Save on its own', () => {
    render(<NameCard />);
    act(() => store.set({ ...store.clinic, name: 'Renamed on another device' }));
    expect(screen.getByLabelText('Clinic name')).toHaveValue('Renamed on another device');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('a change to a field this card does not own leaves it alone', () => {
    render(<NameCard />);
    act(() => store.set({ ...store.clinic, address: '2 New Road' }));
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('a card with edits keeps them when the saved values change underneath', () => {
    render(<NameCard />);
    fireEvent.change(screen.getByLabelText('Clinic name'), { target: { value: 'My edit' } });
    act(() => store.set({ ...store.clinic, name: 'Renamed on another device' }));
    expect(screen.getByLabelText('Clinic name')).toHaveValue('My edit');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
  });

  it('Cancel puts the saved value back and hides the bar', () => {
    render(<NameCard />);
    fireEvent.change(screen.getByLabelText('Clinic name'), { target: { value: 'My edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Clinic name')).toHaveValue('Physio Clinic');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('Save shows "Saved" for a moment, then the bar goes away', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<NameCard />);
    fireEvent.change(screen.getByLabelText('Clinic name'), { target: { value: 'Physio Clinic Plus' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    });
    expect(store.clinic.name).toBe('Physio Clinic Plus');
    expect(screen.getByText('Saved ✓')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(SAVED_NOTE_MS + 50);
    });
    expect(screen.queryByText('Saved ✓')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});
