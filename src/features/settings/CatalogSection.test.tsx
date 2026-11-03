// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('./ServicesView', () => ({ ServicesView: () => <p>services list</p> }));
vi.mock('./TreatmentsView', () => ({ TreatmentCatalog: () => <p>treatments list</p> }));

import { CatalogSection } from './CatalogSection';

afterEach(cleanup);

describe('Services & treatments tab', () => {
  it('switches between Services and Treatments, with no referral view', () => {
    const onViewChange = vi.fn();
    const { rerender } = render(<CatalogSection view="packages" onViewChange={onViewChange} />);
    expect(screen.getByRole('radio', { name: 'Services' })).toBeChecked();
    expect(screen.getByText('services list')).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /Referral/ })).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: 'Treatments' }));
    expect(onViewChange).toHaveBeenCalledWith('treatments');
    rerender(<CatalogSection view="treatments" onViewChange={onViewChange} />);
    expect(screen.getByText('treatments list')).toBeInTheDocument();
  });
});
