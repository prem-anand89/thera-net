// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ShowMoreFooter, useShowMore } from './ShowMore';

afterEach(cleanup);

function Harness({ n, resetKey = 'a' }: { n: number; resetKey?: string }) {
  const items = Array.from({ length: n }, (_, i) => `row ${i + 1}`);
  const list = useShowMore(items, resetKey);
  return (
    <div>
      <ul>
        {list.visible.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <ShowMoreFooter list={list} noun="patients" />
    </div>
  );
}

describe('useShowMore / ShowMoreFooter', () => {
  it('shows no footer for a short list', () => {
    render(<Harness n={8} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
  });

  it('shows 10, then 10 more, then all, then collapses', () => {
    render(<Harness n={43} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByText('Showing 10 of 43 patients')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show 10 more' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(20);

    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(43);
    expect(screen.getByText('Showing all 43 patients')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
  });

  it('caps the last "Show more" at what is left', () => {
    render(<Harness n={14} />);
    expect(screen.getByRole('button', { name: 'Show 4 more' })).toBeInTheDocument();
  });

  it('collapses back to the first page when the list identity changes', () => {
    const { rerender } = render(<Harness n={43} resetKey="a" />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(43);
    rerender(<Harness n={43} resetKey="b" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(10);
  });
});
