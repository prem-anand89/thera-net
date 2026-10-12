// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { PieChart } from './PieChart';

afterEach(cleanup);

describe('PieChart', () => {
  it('draws a full circle when one slice is 100% (an arc with equal ends draws nothing)', () => {
    const { container } = render(<PieChart data={[{ label: 'Unknown', value: 40 }]} />);
    expect(container.querySelectorAll('circle')).toHaveLength(1);
    expect(container.querySelectorAll('path')).toHaveLength(0);
  });

  it('draws one wedge per slice otherwise', () => {
    const { container } = render(
      <PieChart
        data={[
          { label: 'Doctor', value: 3 },
          { label: 'Walk-in', value: 1 },
        ]}
      />
    );
    expect(container.querySelectorAll('path')).toHaveLength(2);
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });
});
