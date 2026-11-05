// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { sendText } = vi.hoisted(() => ({ sendText: vi.fn() }));
vi.mock('@/services', () => ({ bookingService: { sendText } }));

import { RequestDeclinedStrip } from './RequestDeclinedStrip';

describe('RequestDeclinedStrip', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('offers no message for a patient who asked not to be messaged', () => {
    render(<RequestDeclinedStrip declined={{ name: 'Kavin P', phone: '9820000002', requestedFor: 'x', doNotMessage: true }} clinicName="BM" onDismiss={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Message patient' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('says the patient has not been told and offers the one-tap message to their number', () => {
    const onDismiss = vi.fn();
    render(<RequestDeclinedStrip declined={{ name: 'Kavin P', phone: '9820000002', requestedFor: 'Sat, 31 Oct, 12:00 PM' }} clinicName="BM" onDismiss={onDismiss} />);
    expect(screen.getByText(/haven't been told yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Message patient' }));
    expect(sendText).toHaveBeenCalledWith(expect.stringContaining('Sat, 31 Oct, 12:00 PM'), '9820000002');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});
