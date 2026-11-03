// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createStarterCatalogDrafts } from '@/domain/onboardingCatalogTemplates';
import { ServiceCatalogTemplateEditor } from './ServiceCatalogTemplateEditor';

afterEach(cleanup);

describe('ServiceCatalogTemplateEditor — Step 11 look', () => {
  it('renders group headings and no Rename group or Add group box', () => {
    render(<ServiceCatalogTemplateEditor drafts={createStarterCatalogDrafts()} onChange={vi.fn()} />);
    expect(screen.getByText('Consultation')).toBeInTheDocument();
    expect(screen.getByText('Physiotherapy')).toBeInTheDocument();
    expect(screen.queryByText('Rename group')).toBeNull();
    expect(screen.queryByText('Add another group (optional)')).toBeNull();
  });

  it('shows "₹700 each", no "≈", and no "Single visit" badge', () => {
    render(<ServiceCatalogTemplateEditor drafts={createStarterCatalogDrafts()} onChange={vi.fn()} />);
    expect(screen.getByText(/₹700 each/)).toBeInTheDocument();
    expect(screen.queryByText(/≈/)).toBeNull();
    expect(screen.queryByText('Single visit')).toBeNull();
  });

  it('renders editable name inputs with inputCls styling', () => {
    render(<ServiceCatalogTemplateEditor drafts={createStarterCatalogDrafts()} onChange={vi.fn()} />);
    const inputs = screen.getAllByRole('textbox', { name: 'Service name' });
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs[0]).toHaveClass('rounded-lg', 'border');
  });

  it('flags duplicate row names at the row as the user types', () => {
    const drafts = createStarterCatalogDrafts();
    drafts[1].name = drafts[0].name;
    render(<ServiceCatalogTemplateEditor drafts={drafts} onChange={vi.fn()} />);
    expect(
      screen.getAllByText(new RegExp(`Duplicate name: "${drafts[0].name}" is already in use`)).length
    ).toBeGreaterThan(0);
  });

  it('provides a dashed row to add a service as one visit or package, with the guidance note', async () => {
    const onChange = vi.fn();
    render(<ServiceCatalogTemplateEditor drafts={createStarterCatalogDrafts()} onChange={onChange} />);
    expect(
      screen.getByText('You can change prices, groups and treatments anytime in Settings → Services & treatments.')
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '+ Add a service' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: '', sessionCount: 1, enabled: true }),
      ])
    );

    await userEvent.click(screen.getByRole('button', { name: 'Package' }));
    expect(onChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: '', sessionCount: 5, enabled: true }),
      ])
    );
  });
});
