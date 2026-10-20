// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TherapistColorPicker, TherapistColorSheet } from './TherapistColorPicker';
import { THERAPIST_PALETTE } from './scheduleColors';

describe('TherapistColorPicker', () => {
  afterEach(cleanup);

  it('offers the eight swatches, marks the chosen one, and reports a pick', () => {
    const onChange = vi.fn();
    render(<TherapistColorPicker value={THERAPIST_PALETTE[0]} onChange={onChange} />);
    expect(screen.getAllByRole('button')).toHaveLength(8);
    expect(screen.getByRole('button', { name: 'Blue' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Orange' }));
    expect(onChange).toHaveBeenCalledWith(THERAPIST_PALETTE[1]);
  });

  it('says who already uses a swatch', () => {
    render(<TherapistColorPicker value={THERAPIST_PALETTE[0]} onChange={vi.fn()} takenBy={{ [THERAPIST_PALETTE[1].toLowerCase()]: 'Kiran Balla' }} />);
    expect(screen.getByRole('button', { name: 'Orange, used by Kiran Balla' })).toBeInTheDocument();
    expect(screen.getByText("Kiran's")).toBeInTheDocument();
  });

  it('refuses a custom color too light to see, and accepts a dark one', () => {
    const onChange = vi.fn();
    render(<TherapistColorPicker value={THERAPIST_PALETTE[0]} onChange={onChange} />);
    const custom = screen.getByLabelText('Custom color');
    fireEvent.change(custom, { target: { value: '#f5f5a0' } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('too light');
    fireEvent.change(custom, { target: { value: '#123456' } });
    expect(onChange).toHaveBeenCalledWith('#123456');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('previews the color on a sample block', () => {
    render(<TherapistColorPicker value="#6254b2" onChange={vi.fn()} name="Kiran" />);
    expect(document.querySelector('[data-color-preview]')).toHaveTextContent('Kiran');
  });
});

describe('TherapistColorSheet', () => {
  afterEach(cleanup);

  it('saves the chosen swatch, or null for "Use default"', async () => {
    const onSave = vi.fn(async () => {});
    const onClose = vi.fn();
    render(<TherapistColorSheet open onClose={onClose} therapistName="Kiran" value={THERAPIST_PALETTE[0]} takenBy={{}} onSave={onSave} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(THERAPIST_PALETTE[5]));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Use default' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Use default' }));
    await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith(null));
    expect(onClose).toHaveBeenCalled();
  });
});
