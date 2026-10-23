// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(cleanup);
import { SharesRing } from './VisitSharedSplit';
import { VisitServicesList } from './VisitServiceDetails';

const shares = [
  { name: 'Prem', amountPaise: 160000 },
  { name: 'BM', amountPaise: 40000 },
];

describe('SharesRing', () => {
  it('shows the others\' percentage and the rupee line on hover', () => {
    render(<SharesRing shares={shares} primaryName="Prem" />);
    expect(screen.getByText('20%')).toBeTruthy();
    expect(screen.getByLabelText('Revenue share: 20% to others').getAttribute('title')).toContain('Prem ₹1,600 · BM ₹400');
    expect(screen.queryByRole('button')).toBeNull();
  });
  it('is a button that edits only when allowed', () => {
    const onEdit = vi.fn();
    render(<SharesRing shares={shares} primaryName="Prem" onEdit={onEdit} edited />);
    fireEvent.click(screen.getByRole('button'));
    expect(onEdit).toHaveBeenCalled();
  });
  it('shows 100% when the primary has nothing', () => {
    render(<SharesRing shares={[{ name: 'Prem', amountPaise: 0 }, { name: 'BM', amountPaise: 30000 }]} primaryName="Prem" />);
    expect(screen.getByText('100%')).toBeTruthy();
  });
});

describe('VisitServicesList', () => {
  it('chips the assistant and collapses past max', () => {
    render(
      <VisitServicesList
        max={2}
        services={[
          { name: 'A', assistantName: null },
          { name: 'B', assistantName: 'Dr BM Rao' },
          { name: 'C', assistantName: null },
          { name: 'D', assistantName: null },
        ]}
      />
    );
    expect(screen.getByText('BR')).toBeTruthy();
    expect(screen.getByText('+2 more')).toBeTruthy();
    expect(screen.queryByText('C')).toBeNull();
  });
});
