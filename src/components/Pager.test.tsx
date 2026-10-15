// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { Pager, usePagination } from './Pager';

const items = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe('usePagination', () => {
  it('slices by page and reports the visible range', () => {
    const { result } = renderHook(() => usePagination(items(60), 'k', 't', 25));
    expect(result.current.visible).toHaveLength(25);
    expect(result.current.pageCount).toBe(3);
    act(() => result.current.setPage(3));
    expect(result.current.visible).toEqual(items(60).slice(50));
    expect([result.current.from, result.current.to]).toEqual([51, 60]);
  });

  it('returns to page 1 when the filter key changes', () => {
    const { result, rerender } = renderHook(({ k }) => usePagination(items(60), k, 't', 25), {
      initialProps: { k: 'a' },
    });
    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);
    rerender({ k: 'b' });
    expect(result.current.page).toBe(1);
  });

  it('clamps the page when the list shrinks', () => {
    const { result, rerender } = renderHook(({ n }) => usePagination(items(n), 'k', 't', 10), {
      initialProps: { n: 60 },
    });
    act(() => result.current.setPage(6));
    rerender({ n: 15 });
    expect(result.current.page).toBe(2);
    rerender({ n: 0 });
    expect(result.current.page).toBe(1);
    expect(result.current.from).toBe(0);
  });

  it('remembers the page size per list', () => {
    const first = renderHook(() => usePagination(items(60), 'k', 'remember', 25));
    act(() => first.result.current.setSize(10));
    first.unmount();
    const second = renderHook(() => usePagination(items(60), 'k', 'remember', 25));
    expect(second.result.current.size).toBe(10);
  });
});

describe('Pager', () => {
  function Harness({ n }: { n: number }) {
    const list = usePagination(items(n), 'k', 'h', 10);
    return (
      <>
        <ul>{list.visible.map((i) => <li key={i}>{i}</li>)}</ul>
        <Pager list={list} noun="patients" />
      </>
    );
  }

  it('renders nothing for a list that fits one small page', () => {
    render(<Harness n={10} />);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('pages forward and back and disables the ends', () => {
    render(<Harness n={25} />);
    expect(screen.getByRole('navigation')).toHaveTextContent('1–10 of 25 patients');
    expect(screen.getByRole('button', { name: /Prev/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByText('11')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(screen.getByRole('button', { name: /Next/ })).toBeDisabled();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('switches rows per page between 10 and 25', () => {
    render(<Harness n={60} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '25' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(25);
  });
});
