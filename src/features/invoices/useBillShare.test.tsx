// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { useBillShare } from './useBillShare';

const m = vi.hoisted(() => ({
  render: vi.fn(),
  share: vi.fn(),
  download: vi.fn(),
  canShare: vi.fn(),
}));
vi.mock('@/lib/pdfShare', () => ({
  renderElementToPdf: m.render,
  shareBillFile: m.share,
  downloadFile: m.download,
  canShareFiles: m.canShare,
}));

const fileA = new File(['a'], 'a.pdf');
const fileB = new File(['b'], 'b.pdf');
const setup = (canShare: boolean, ready = false) => {
  m.canShare.mockReturnValue(canShare);
  const contentRef = { current: document.createElement('div') };
  return renderHook(
    ({ freshnessKey }) => useBillShare({ contentRef, fileName: 'x.pdf', title: 'Bill', paper: 'A4', freshnessKey, ready }),
    { initialProps: { freshnessKey: 'k1' } }
  );
};

beforeEach(() => {
  vi.useFakeTimers();
  m.render.mockReset().mockResolvedValue(fileA);
  m.share.mockReset().mockResolvedValue('shared');
  m.download.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useBillShare', () => {
  it('first tap prepares, and only the second tap sends', async () => {
    const { result } = setup(true);
    await act(async () => result.current.send());
    expect(result.current.phase).toBe('ready');
    expect(m.share).not.toHaveBeenCalled();
    await act(async () => result.current.send());
    expect(m.share).toHaveBeenCalledWith(fileA, 'Bill');
    expect(result.current.phase).toBe('closed');
  });

  it('prepares in the background, so one tap sends', async () => {
    const { result } = setup(true, true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });
    expect(m.render).toHaveBeenCalledTimes(1);
    await act(async () => result.current.send());
    expect(m.share).toHaveBeenCalledWith(fileA, 'Bill');
  });

  it('never sends a PDF prepared before the bill changed', async () => {
    const { result, rerender } = setup(true);
    await act(async () => result.current.send());
    m.render.mockResolvedValue(fileB);
    await act(async () => rerender({ freshnessKey: 'k2' }));
    await act(async () => result.current.send());
    expect(m.share).toHaveBeenCalledTimes(1);
    expect(m.share).toHaveBeenCalledWith(fileB, 'Bill');
  });

  it('keeps the file and asks for another tap when the browser refuses a stale tap', async () => {
    m.share.mockResolvedValue('needs-tap');
    const { result } = setup(true);
    await act(async () => result.current.send());
    await act(async () => result.current.send());
    expect(result.current.phase).toBe('ready');
  });

  it('downloads on a device that cannot share files, without background work', async () => {
    const { result } = setup(false, true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7000);
    });
    expect(m.render).not.toHaveBeenCalled();
    await act(async () => result.current.send());
    expect(m.download).toHaveBeenCalledWith(fileA);
    expect(result.current.phase).toBe('downloaded');
  });

  it('says so when the PDF cannot be built', async () => {
    m.render.mockRejectedValue(new Error('no'));
    const { result } = setup(true);
    await act(async () => result.current.send());
    expect(result.current.phase).toBe('failed');
  });
});
