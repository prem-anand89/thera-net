// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PackageThread } from './ui';

afterEach(cleanup);

describe('PackageThread', () => {
  it('shows one dot per session for a short package', () => {
    const { container } = render(<PackageThread sessionIndex={4} packageTotal={7} />);
    expect(container.querySelectorAll('span.rounded-full')).toHaveLength(7);
  });

  it('becomes a fixed-width progress bar for a long package so it never runs out of its cell', () => {
    const { container } = render(<PackageThread sessionIndex={15} packageTotal={30} />);
    expect(screen.getByRole('img', { name: 'Session 15 of 30' })).toBeInTheDocument();
    expect(container.querySelectorAll('span.rounded-full').length).toBeLessThanOrEqual(2);
    const fill = container.querySelector('span[style]') as HTMLElement;
    expect(fill.style.width).toBe('50%');
  });
});
