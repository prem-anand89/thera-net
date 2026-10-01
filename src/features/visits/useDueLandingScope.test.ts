// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDueLandingScope } from './useDueLandingScope';

type Props = { dueLanding: boolean; isClinicWideView: boolean; myTherapistId: string | undefined };

function setup(initial: Props) {
  const setTherapistId = vi.fn();
  const hook = renderHook((props: Props) => useDueLandingScope({ ...props, setTherapistId }), {
    initialProps: initial,
  });
  return { setTherapistId, ...hook };
}

describe('useDueLandingScope', () => {
  it('narrows to the therapist once their id loads after the first render', () => {
    const { setTherapistId, rerender } = setup({ dueLanding: true, isClinicWideView: false, myTherapistId: undefined });
    expect(setTherapistId).not.toHaveBeenCalled();
    rerender({ dueLanding: true, isClinicWideView: false, myTherapistId: 'th-1' });
    expect(setTherapistId).toHaveBeenCalledWith('th-1');
    rerender({ dueLanding: true, isClinicWideView: false, myTherapistId: 'th-1' });
    expect(setTherapistId).toHaveBeenCalledTimes(1); // once — the user can change it after
  });

  it('leaves clinic-wide roles and ordinary visits to the Ledger alone', () => {
    const wide = setup({ dueLanding: true, isClinicWideView: true, myTherapistId: 'th-1' });
    expect(wide.setTherapistId).not.toHaveBeenCalled();
    const plain = setup({ dueLanding: false, isClinicWideView: false, myTherapistId: 'th-1' });
    expect(plain.setTherapistId).not.toHaveBeenCalled();
  });
});
