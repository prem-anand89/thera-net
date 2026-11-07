// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CopyAddressButton } from './CopyAddressButton';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('CopyAddressButton', () => {
  it('copies the address and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<CopyAddressButton address="12 Lake Rd" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    expect(writeText).toHaveBeenCalledWith('12 Lake Rd');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Address copied ✓' })).toBeTruthy());
  });

  it('does not throw and keeps its label when there is no clipboard', () => {
    vi.stubGlobal('navigator', {});
    render(<CopyAddressButton address="12 Lake Rd" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeTruthy();
  });

  it('keeps its label when the clipboard refuses', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) } });
    render(<CopyAddressButton address="12 Lake Rd" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
    await Promise.resolve();
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeTruthy();
  });
});
