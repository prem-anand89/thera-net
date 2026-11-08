// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MonthStepper } from './MonthStepper';

afterEach(cleanup);

describe('MonthStepper', () => {
  it('steps back and forward', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    render(<MonthStepper label="Nov 2026" canPrev canNext onPrev={onPrev} onNext={onNext} />);
    fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Nov 2026')).toBeInTheDocument();
  });

  it('disables an end and says it is not available', () => {
    render(<MonthStepper label="Nov 2026" canPrev canNext={false} onPrev={() => {}} onNext={() => {}} />);
    expect(screen.getByRole('button', { name: 'Next month, not available' })).toBeDisabled();
  });
});
