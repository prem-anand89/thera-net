// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { PickerMenu, type PickerOption } from './PickerMenu';

afterEach(cleanup);

const people = (n: number): PickerOption[] => Array.from({ length: n }, (_, i) => ({ value: `t${i}`, label: `Dr ${String.fromCharCode(65 + i)}`, dotColor: '#2e9e3f' }));

function setup(options: PickerOption[], onChange = vi.fn(), value = 't0') {
  render(
    <PickerMenu
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel="Therapist"
      caption="Who treated the patient"
      triggerClassName="pill"
      renderTrigger={(selected) => <span>{selected?.label ?? 'Choose'}</span>}
    />
  );
  return onChange;
}

describe('PickerMenu', () => {
  it('names the button for screen readers and lists every option when the team is small', () => {
    setup(people(3));
    fireEvent.click(screen.getByRole('button', { name: 'Therapist: Dr A' }));
    expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(3);
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('adds a search box for a big team and filters by name', () => {
    setup(people(10));
    fireEvent.click(screen.getByRole('button', { name: /^Therapist:/ }));
    const search = screen.getByRole('searchbox');
    fireEvent.change(search, { target: { value: 'dr c' } });
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((o) => o.textContent?.replace('✓', ''))).toEqual(['Dr C']);
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByText('No match')).toBeInTheDocument();
  });

  it('picks with a click, closes, and reports the value', () => {
    const onChange = setup(people(3));
    fireEvent.click(screen.getByRole('button', { name: /^Therapist:/ }));
    fireEvent.click(screen.getByRole('option', { name: /Dr B/ }));
    expect(onChange).toHaveBeenCalledWith('t1');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('shows "Choose" when nothing is selected', () => {
    setup(people(3), vi.fn(), '');
    expect(screen.getByRole('button', { name: 'Therapist: none' })).toHaveTextContent('Choose');
  });
});
