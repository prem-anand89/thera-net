// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let mockState: 'unsupported' | 'default' = 'default';
vi.mock('./pushSubscription', () => ({
  pushState: async () => mockState,
  enablePushForThisDevice: vi.fn(),
  disablePushForThisDevice: vi.fn(),
}));
vi.mock('@/app/useSession', () => ({ useSession: () => ({ session: { user: { id: 'u1' } } }) }));

import { PushSettingsCard } from './PushSettingsCard';

afterEach(() => {
  cleanup();
  mockState = 'default';
});

describe('PushSettingsCard', () => {
  it('shows the enable button when permission has not been asked', async () => {
    render(<PushSettingsCard />);
    expect(await screen.findByRole('button', { name: 'Turn on notifications' })).toBeInTheDocument();
  });

  it('renders nothing on browsers without push support', async () => {
    mockState = 'unsupported';
    const { container } = render(<PushSettingsCard />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
