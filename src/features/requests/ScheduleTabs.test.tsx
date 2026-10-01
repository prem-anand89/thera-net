// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className, ...rest }: { children: React.ReactNode; className?: string; 'aria-current'?: 'page' }) => (
    <a href="#" className={className} aria-current={rest['aria-current']}>{children}</a>
  ),
}));

import { ScheduleTabs } from './ScheduleTabs';

describe('ScheduleTabs', () => {
  afterEach(cleanup);

  it('shows Schedule, History and (for admins) Feedback, with actions on the right', () => {
    render(<ScheduleTabs active="history" showFeedback scheduleLabel="Schedule" actions={<button type="button">+ Book</button>} />);
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Feedback' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ Book' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Schedule' })).toBeInTheDocument();
  });

  it('hides Feedback for therapists and uses their label', () => {
    render(<ScheduleTabs active="schedule" showFeedback={false} scheduleLabel="My schedule" />);
    expect(screen.getByRole('link', { name: 'My schedule' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('link', { name: 'Feedback' })).not.toBeInTheDocument();
  });
});
