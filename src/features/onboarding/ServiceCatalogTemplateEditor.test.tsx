// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

  it('package session box clamps to min 2 and does not flip to a one-visit row', async () => {
    function StatefulEditor() {
      const [drafts, setDrafts] = useState(() => createStarterCatalogDrafts());
      return <ServiceCatalogTemplateEditor drafts={drafts} onChange={setDrafts} />;
    }
    render(<StatefulEditor />);

    const sessionsInput = screen.getByLabelText('Sessions') as HTMLInputElement;
    expect(sessionsInput).toHaveAttribute('min', '2');
    expect(sessionsInput.value).toBe('5');

    // Setting to 10 works
    fireEvent.change(sessionsInput, { target: { value: '10' } });
    expect(sessionsInput.value).toBe('10');

    // Setting below 2 (e.g. 1 or 0 or empty) clamps to 2 and never drops to 1
    fireEvent.change(sessionsInput, { target: { value: '1' } });
    expect(sessionsInput.value).toBe('2');

    fireEvent.change(sessionsInput, { target: { value: '0' } });
    expect(sessionsInput.value).toBe('2');

    fireEvent.change(sessionsInput, { target: { value: '' } });
    expect(sessionsInput.value).toBe('2');
  });

  it('flags duplicate row names only among priced drafts that will be saved', () => {
    const drafts = createStarterCatalogDrafts();
    drafts[1].name = drafts[0].name;
    // When both are priced & enabled, duplicate warning shows
    const { rerender } = render(<ServiceCatalogTemplateEditor drafts={drafts} onChange={vi.fn()} />);
    expect(
      screen.getAllByText(new RegExp(`Duplicate name: "${drafts[0].name}" is already in use`)).length
    ).toBeGreaterThan(0);

    // If one is disabled (unticked), warning disappears because unticked rows are not saved
    const unticked = drafts.map((d, i) => (i === 1 ? { ...d, enabled: false } : d));
    rerender(<ServiceCatalogTemplateEditor drafts={unticked} onChange={vi.fn()} />);
    expect(screen.queryByText(/Duplicate name:/)).toBeNull();

    // If one has no price, warning disappears because unpriced rows are not saved
    const unpriced = drafts.map((d, i) => (i === 1 ? { ...d, basePricePaise: null } : d));
    rerender(<ServiceCatalogTemplateEditor drafts={unpriced} onChange={vi.fn()} />);
    expect(screen.queryByText(/Duplicate name:/)).toBeNull();
  });

  it('flags near duplicates quietly without blocking', () => {
    const drafts = createStarterCatalogDrafts();
    // Assessment vs Assessment-s
    drafts[0].name = 'Initial Assessment';
    drafts[1].name = 'Initial Assessments';
    render(<ServiceCatalogTemplateEditor drafts={drafts} onChange={vi.fn()} />);
    expect(screen.getAllByText(/Similar to "Initial Assessment"/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Duplicate name:/)).toBeNull();
  });

  it('provides a single dashed row with One visit and Package choices, and guidance note', async () => {
    const onChange = vi.fn();
    render(<ServiceCatalogTemplateEditor drafts={createStarterCatalogDrafts()} onChange={onChange} />);
    expect(
      screen.getByText('You can change prices, groups and treatments anytime in Settings → Services & treatments.')
    ).toBeInTheDocument();
    expect(screen.getByText('+ Add a service:')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'One visit' }));
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
