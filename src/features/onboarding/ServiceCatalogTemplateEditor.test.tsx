// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
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

  it('renders editable name inputs with inputCls styling and labelled rupee price inputs', () => {
    render(<ServiceCatalogTemplateEditor drafts={createStarterCatalogDrafts()} onChange={vi.fn()} />);
    expect(screen.getByText('Service name')).toBeInTheDocument();
    expect(screen.getByText('Price (₹)')).toBeInTheDocument();
    const inputs = screen.getAllByRole('textbox', { name: 'Service name' });
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs[0]).toHaveClass('rounded-lg', 'border');
    const prices = screen.getAllByRole('spinbutton', { name: 'Price in rupees' });
    expect(prices.length).toBe(inputs.length);
  });

  it('keeps rows in template order and adds a new row at the bottom', async () => {
    function StatefulEditor() {
      const [drafts, setDrafts] = useState(() => createStarterCatalogDrafts());
      return <ServiceCatalogTemplateEditor drafts={drafts} onChange={setDrafts} />;
    }
    render(<StatefulEditor />);
    const namesBefore = screen.getAllByRole('textbox', { name: 'Service name' }).map((el) => (el as HTMLInputElement).value);
    expect(namesBefore[0]).toBe('Initial Consultation');
    expect(namesBefore[1]).toBe('Follow-up Consultation');

    // Adding a new service appends it at the bottom instead of jumping to the top of the group
    await userEvent.click(screen.getByRole('button', { name: 'One visit' }));
    const inputsAfterAdd = screen.getAllByRole('textbox', { name: 'Service name' }) as HTMLInputElement[];
    expect(inputsAfterAdd[inputsAfterAdd.length - 1].value).toBe('');
  });

  it('says on the row when a ticked service would be left out, and treats a blank price as blank, not ₹0', () => {
    const drafts = createStarterCatalogDrafts();
    drafts[0].basePricePaise = null;
    drafts[1].name = '  ';
    render(<ServiceCatalogTemplateEditor drafts={drafts} onChange={vi.fn()} />);
    const notes = screen.getAllByTestId('row-not-saved').map((n) => n.textContent);
    expect(notes).toContain("Add a price to include this (₹0 if it's free).");
    expect(notes).toContain('Add a name to include this.');
    expect(screen.getAllByRole('spinbutton', { name: 'Price in rupees' })[0]).toHaveAttribute('placeholder', '–');
  });

  it('name and price boxes stay 16px on phones: no text-sm on top of inputCls, so iOS does not zoom on focus', () => {
    render(<ServiceCatalogTemplateEditor drafts={createStarterCatalogDrafts()} onChange={vi.fn()} />);
    const boxes = [
      screen.getAllByRole('textbox', { name: 'Service name' })[0],
      screen.getAllByRole('spinbutton', { name: 'Price in rupees' })[0],
    ];
    for (const box of boxes) {
      expect(box).toHaveClass('text-base');
      expect(box).not.toHaveClass('text-sm');
    }
  });

  it('package sessions use a stepper with 5/10 presets and never drop below 2', async () => {
    function StatefulEditor() {
      const [drafts, setDrafts] = useState(() => createStarterCatalogDrafts());
      return <ServiceCatalogTemplateEditor drafts={drafts} onChange={setDrafts} />;
    }
    render(<StatefulEditor />);

    const group = screen.getByRole('group', { name: 'Number of sessions' });
    const value = () => group.querySelector('output')?.textContent;
    expect(value()).toBe('5');

    await userEvent.click(screen.getByRole('button', { name: '10 sessions' }));
    expect(value()).toBe('10');

    await userEvent.click(screen.getByRole('button', { name: 'One more session' }));
    expect(value()).toBe('11');

    await userEvent.click(screen.getByRole('button', { name: '10 sessions' }));
    for (let i = 0; i < 12; i++) {
      const fewer = screen.getByRole('button', { name: 'One fewer session' });
      if (!(fewer as HTMLButtonElement).disabled) await userEvent.click(fewer);
    }
    expect(value()).toBe('2');
    expect(screen.getByRole('button', { name: 'One fewer session' })).toBeDisabled();
    // Still a package row: the stepper is still there.
    expect(screen.getByRole('group', { name: 'Number of sessions' })).toBeInTheDocument();
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
