// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { PatientAddressLine } from './PatientAddressLine';

afterEach(cleanup);

describe('PatientAddressLine', () => {
  it('shows the address and a Copy button for a clinic that does home visits', () => {
    render(<PatientAddressLine clinic={{ careLocations: ['clinic', 'home'] }} address="12 Lake Rd" />);
    expect(screen.getByText('12 Lake Rd')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeTruthy();
  });

  it('shows nothing when home visits are off', () => {
    const { container } = render(<PatientAddressLine clinic={{ careLocations: ['clinic'] }} address="12 Lake Rd" />);
    expect(container.textContent).toBe('');
  });

  it('shows nothing without an address', () => {
    const { container } = render(<PatientAddressLine clinic={{ careLocations: ['clinic', 'home'] }} address="  " />);
    expect(container.textContent).toBe('');
  });
});
