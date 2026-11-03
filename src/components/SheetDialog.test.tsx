// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SheetDialog } from './ui';

afterEach(cleanup);

describe('SheetDialog', () => {
  it('is a titled dialog with its buttons and any problem outside the scrolling body', () => {
    render(
      <SheetDialog open title="Add a service" onClose={vi.fn()} error="Name is required" footer={<button type="button">Add</button>}>
        <p>Body</p>
      </SheetDialog>
    );
    const dialog = screen.getByRole('dialog', { name: 'Add a service' });
    const body = screen.getByText('Body').parentElement!;
    expect(body.className).toMatch(/overflow-y-auto/);
    expect(body).not.toContainElement(screen.getByRole('button', { name: 'Add' }));
    expect(body).not.toContainElement(screen.getByRole('alert'));
    expect(dialog).toContainElement(screen.getByRole('alert'));
  });

  it('closes on Escape and on the backdrop, but not while busy', () => {
    const onClose = vi.fn();
    const { rerender } = render(<SheetDialog open title="T" onClose={onClose} footer={null}>x</SheetDialog>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(<SheetDialog open busy title="T" onClose={onClose} footer={null}>x</SheetDialog>);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when closed', () => {
    render(<SheetDialog open={false} title="T" onClose={vi.fn()} footer={null}>x</SheetDialog>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
