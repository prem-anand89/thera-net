// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { RequestGhostBlock, type RequestGhost } from './RequestGhostBlock';

const ghost = (over: Partial<RequestGhost> = {}): RequestGhost => ({
  id: 'r1',
  name: 'John Doe',
  date: '2026-10-30',
  minutes: 10 * 60,
  therapistId: 't1',
  onConfirm: vi.fn(),
  onDecline: vi.fn(),
  ...over,
});

describe('RequestGhostBlock', () => {
  afterEach(cleanup);

  it('sits at the requested time and opens Confirm / Decline on tap', () => {
    const g = ghost();
    const { container } = render(<RequestGhostBlock ghost={g} hoursStart={7} pxPerMinute={1.6} overlapsAppointment={false} />);
    // (10:00 - 7:00) hours * 60 * 1.6 px, plus the 1px nudge
    expect(container.querySelector('[data-request-ghost]')).toHaveStyle({ top: `${3 * 60 * 1.6 + 1}px` });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Booking request from John Doe for 10:00 AM/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(g.onConfirm).toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Booking request from/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(g.onDecline).toHaveBeenCalled();
  });

  it('shrinks to a small tab when an appointment is already at that time, so neither covers the other', () => {
    render(<RequestGhostBlock ghost={ghost()} hoursStart={7} pxPerMinute={1.6} overlapsAppointment />);
    const tab = screen.getByRole('button', { name: /Booking request from John Doe/ });
    expect(tab).toHaveTextContent('Req');
    expect(tab.parentElement?.className).toContain('w-14');
  });

  it('closes on Escape', () => {
    render(<RequestGhostBlock ghost={ghost()} hoursStart={7} pxPerMinute={1.6} overlapsAppointment={false} />);
    fireEvent.click(screen.getByRole('button', { name: /Booking request from/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
