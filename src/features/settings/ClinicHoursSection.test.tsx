// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/app/clinicContext', () => ({
  useClinic: () => ({ id: 'c1', name: 'Physio Clinic', bookingStartHour: 9, bookingEndHour: 18, closedWeekdays: [0], slotDurationMinutes: 30 }),
}));
vi.mock('@/services', () => ({ repos: { clinics: { get: async () => undefined, put: vi.fn() } } }));
vi.mock('@/lib/supabase', () => ({ getSupabase: () => null, publicLogoUrl: () => null }));

import { ClinicHoursSection } from './ClinicSections';

describe('Hours & closures with no Edit button', () => {
  afterEach(cleanup);

  it('the open-days strip and "Add different hours" respond on the first click', () => {
    render(<ClinicHoursSection onDirtyChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    const sun = screen.getByRole('button', { name: 'Sun' });
    expect(sun).toBeEnabled();
    fireEvent.click(sun);
    expect(sun).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /Add different hours/ })).toBeEnabled();
  });
});
