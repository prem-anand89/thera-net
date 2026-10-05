// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

let pushStateValue: 'default' | 'on' | 'denied' | 'unsupported' = 'default';
vi.mock('./pushSubscription', () => ({
  pushState: async () => pushStateValue,
  enablePushForThisDevice: vi.fn(),
}));
vi.mock('@/app/useSession', () => ({ useSession: () => ({ session: { user: { id: 'u1' } } }) }));

let dismissed: string | null = null;
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => dismissed }));
vi.mock('@/lib/db', () => ({ db: { meta: { get: async () => ({ value: dismissed }), put: vi.fn() } } }));

import { NotificationNudge } from './NotificationNudge';

afterEach(() => {
  cleanup();
  pushStateValue = 'default';
  dismissed = null;
});

describe('NotificationNudge', () => {
  it('shows the reminder on a device that has not decided', async () => {
    render(<NotificationNudge />);
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeInTheDocument();
  });

  it('stays hidden when notifications are already on or blocked', async () => {
    pushStateValue = 'on';
    const { container } = render(<NotificationNudge />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('stays hidden for 30 days after Not now', async () => {
    dismissed = new Date().toISOString();
    const { container } = render(<NotificationNudge />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
