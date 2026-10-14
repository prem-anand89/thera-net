// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

let pending = 0;
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => pending }));
vi.mock('@/lib/db', () => ({ db: { outbox: { count: () => pending } } }));

import { ForeignPendingScreen } from './ForeignPendingScreen';
import { UnsyncedNotice } from './UnsyncedNotice';

afterEach(cleanup);

describe('UnsyncedNotice', () => {
  it('is hidden with nothing pending', () => {
    pending = 0;
    const { container } = render(<UnsyncedNotice />);
    expect(container).toBeEmptyDOMElement();
  });
  it('says how many changes are still saved on the device', () => {
    pending = 3;
    render(<UnsyncedNotice />);
    expect(screen.getByRole('status')).toHaveTextContent(/3 changes on this device have not synced yet/);
  });
});

describe('ForeignPendingScreen', () => {
  it('offers discard and sign out', async () => {
    const onDiscard = vi.fn();
    const onSignOut = vi.fn();
    render(<ForeignPendingScreen count={2} onDiscard={onDiscard} onSignOut={onSignOut} />);
    expect(screen.getByText(/2 unsynced changes from a different account/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Discard and continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onDiscard).toHaveBeenCalledTimes(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
