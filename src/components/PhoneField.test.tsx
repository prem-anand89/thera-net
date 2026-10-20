// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { PhoneField } from './PhoneField';

function Harness({ initial = '', onChange }: { initial?: string; onChange?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <PhoneField
        id="p"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
      />
      <button type="button" onClick={() => setValue('+971 501234567')}>
        reset
      </button>
    </>
  );
}

describe('PhoneField', () => {
  afterEach(cleanup);

  it('starts on +91 and stores "+91 number" as the digits are typed', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByLabelText('Country code')).toHaveValue('+91');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '98765 43210' } });
    expect(onChange).toHaveBeenLastCalledWith('+91 98765 43210');
  });

  it('an existing number saved without a code shows under +91 without its leading 0', () => {
    render(<Harness initial="09876543210" />);
    expect(screen.getByLabelText('Country code')).toHaveValue('+91');
    expect(screen.getByRole('textbox')).toHaveValue('9876543210');
  });

  it('changing the code re-stores the number with it; clearing the number stores nothing', () => {
    const onChange = vi.fn();
    render(<Harness initial="+91 9876543210" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Country code'), { target: { value: '+971' } });
    expect(onChange).toHaveBeenLastCalledWith('+971 9876543210');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('follows an outside change (e.g. another patient picked)', () => {
    render(<Harness initial="9876543210" />);
    fireEvent.click(screen.getByText('reset'));
    expect(screen.getByLabelText('Country code')).toHaveValue('+971');
    expect(screen.getByRole('textbox')).toHaveValue('501234567');
  });
});
