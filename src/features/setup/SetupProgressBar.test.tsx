// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { buildSetupSteps, summarizeSetup, type SetupSignals } from '@/domain/setupGuide';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, className }: { children: React.ReactNode; to: string; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

const signals: SetupSignals = {
  clinicProfileSet: false,
  servicesPriced: false,
  hasTherapist: true,
  teamInvited: false,
  therapistsLinked: true,
  visitLogged: false,
  backedUp: false,
  unlinkedTherapistCount: 0,
  catalogEmpty: false,
};
let canHide = false;
const hide = vi.fn();
vi.mock('./useSetupProgress', () => ({
  useSetupProgress: () => {
    const [hidden, setHidden] = useState(false);
    return {
      ...summarizeSetup(buildSetupSteps(false, true), signals, new Set()),
      nudgeVisible: !hidden,
      canHide,
      hide: async () => {
        hide();
        setHidden(true);
      },
      setManualDone: vi.fn(),
    };
  },
}));

import { SetupProgressBar } from './SetupProgressBar';

afterEach(() => {
  cleanup();
  hide.mockClear();
  canHide = false;
});

describe('SetupProgressBar Hide', () => {
  it('is not shown before the first visit', () => {
    render(<SetupProgressBar clinicId="c1" />);
    expect(screen.getByText(/Step 1 of/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide' })).not.toBeInTheDocument();
  });

  it('shows after a visit, calls hide(), and then the bar renders nothing', async () => {
    canHide = true;
    const { container } = render(<SetupProgressBar clinicId="c1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }));
    expect(hide).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
  });
});
