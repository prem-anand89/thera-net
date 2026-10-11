// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { PerformanceFilterBar } from './PerformanceFilterBar';

afterEach(cleanup);

describe('PerformanceFilterBar', () => {
  const practitioners = [
    { id: 't1', name: 'Dr. Sarah P.' },
    { id: 't2', name: 'Dr. Amit R.' },
  ];

  it('renders period label, granularity pills, practitioner selector, and compare toggle', () => {
    render(
      <PerformanceFilterBar
        activePeriodLabel="01 Oct 26 → 31 Oct 26"
        granularity="ytd"
        onGranularityChange={vi.fn()}
        practitioners={practitioners}
        selectedPractitionerId={null}
        onPractitionerChange={vi.fn()}
        compareMode={false}
        onCompareModeChange={vi.fn()}
      />
    );

    expect(screen.getByText('01 Oct 26 → 31 Oct 26')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /YTD/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /6m/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /FY/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('combobox', { name: /Filter by practitioner/i })).toHaveValue('');
    expect(screen.getByRole('switch', { name: /Compare previous period/i })).toHaveAttribute('aria-checked', 'false');
  });

  it('calls onGranularityChange when a granularity pill is clicked', () => {
    const onGranularityChange = vi.fn();
    render(
      <PerformanceFilterBar
        activePeriodLabel="01 Oct 26 → 31 Oct 26"
        granularity="ytd"
        onGranularityChange={onGranularityChange}
        practitioners={practitioners}
        selectedPractitionerId={null}
        onPractitionerChange={vi.fn()}
        compareMode={false}
        onCompareModeChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /6m/i }));
    expect(onGranularityChange).toHaveBeenCalledWith('6m');
  });

  it('calls onPractitionerChange when practitioner dropdown changes', () => {
    const onPractitionerChange = vi.fn();
    render(
      <PerformanceFilterBar
        activePeriodLabel="01 Oct 26 → 31 Oct 26"
        granularity="ytd"
        onGranularityChange={vi.fn()}
        practitioners={practitioners}
        selectedPractitionerId={null}
        onPractitionerChange={onPractitionerChange}
        compareMode={false}
        onCompareModeChange={vi.fn()}
      />
    );

    fireEvent.change(screen.getByRole('combobox', { name: /Filter by practitioner/i }), {
      target: { value: 't2' },
    });
    expect(onPractitionerChange).toHaveBeenCalledWith('t2');
  });

  it('toggles compareMode when switch is clicked', () => {
    const onCompareModeChange = vi.fn();
    render(
      <PerformanceFilterBar
        activePeriodLabel="01 Oct 26 → 31 Oct 26"
        granularity="ytd"
        onGranularityChange={vi.fn()}
        practitioners={practitioners}
        selectedPractitionerId={null}
        onPractitionerChange={vi.fn()}
        compareMode={false}
        onCompareModeChange={onCompareModeChange}
      />
    );

    fireEvent.click(screen.getByRole('switch', { name: /Compare previous period/i }));
    expect(onCompareModeChange).toHaveBeenCalledWith(true);
  });
});
