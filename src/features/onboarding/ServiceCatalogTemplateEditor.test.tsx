// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createStarterCatalogDrafts } from '@/domain/onboardingCatalogTemplates';
import { ServiceCatalogTemplateEditor } from './ServiceCatalogTemplateEditor';

afterEach(cleanup);

describe('ServiceCatalogTemplateEditor — same words as Settings', () => {
  it('says "One visit" and "Rename group", and calls extra groups optional', () => {
    render(<ServiceCatalogTemplateEditor drafts={createStarterCatalogDrafts()} onChange={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: '+ One visit' }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: 'Rename group' }).length).toBe(2);
    expect(screen.getByText('Add another group (optional)')).toBeInTheDocument();
    expect(screen.queryByText(/Single session/)).toBeNull();
    expect(screen.queryByText('Add a service group')).toBeNull();
    expect(screen.queryByText('Edit group name')).toBeNull();
  });
});
