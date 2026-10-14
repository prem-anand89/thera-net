// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ getSupabase: () => null }));
vi.mock('@/services', () => ({ repos: {}, bookingService: {} }));
vi.mock('@/app/clinicContext', () => ({ useClinic: () => ({ id: 'c', name: 'Clinic' }) }));
vi.mock('@/app/useSession', () => ({ useSession: () => ({ session: null, loading: false }) }));

import { ChangePasswordDialog } from './ChangePasswordDialog';
import { HelpFeedbackDialog } from './HelpFeedbackDialog';

afterEach(cleanup);

describe('migrated modals get Escape and focus handling', () => {
  it('ChangePasswordDialog closes on Escape and moves focus inside', () => {
    const onClose = vi.fn();
    render(<ChangePasswordDialog onClose={onClose} />);
    expect(screen.getByRole('dialog')).toContainElement(document.activeElement as HTMLElement);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a closed HelpFeedbackDialog does not swallow Escape for the one that is open', () => {
    const closedClose = vi.fn();
    const openClose = vi.fn();
    render(
      <>
        <HelpFeedbackDialog isOpen={false} onClose={closedClose} />
        <ChangePasswordDialog onClose={openClose} />
      </>
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(openClose).toHaveBeenCalledTimes(1);
    expect(closedClose).not.toHaveBeenCalled();
  });
});
