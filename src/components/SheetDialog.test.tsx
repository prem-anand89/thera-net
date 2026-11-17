// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { KebabMenu, SheetDialog } from './ui';

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

  it('omits the bordered footer bar when footer is null and there is no error, and widens at tab: for wide sheets', () => {
    const { rerender } = render(<SheetDialog open wide title="T" onClose={vi.fn()} footer={null}>x</SheetDialog>);
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toContain('tab:max-w-2xl');
    expect(dialog.querySelectorAll('.border-t')).toHaveLength(0);

    rerender(<SheetDialog open wide title="T" onClose={vi.fn()} error="Something failed" footer={null}>x</SheetDialog>);
    expect(screen.getByRole('alert')).toHaveTextContent('Something failed');
  });

  it('portals KebabMenu above SheetDialog so menus inside sheets stay clickable', () => {
    render(
      <SheetDialog open title="T" onClose={vi.fn()} footer={null}>
        <KebabMenu ariaLabel="Row actions">
          {() => <button type="button">Move up</button>}
        </KebabMenu>
      </SheetDialog>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Row actions' }));
    const sheetOverlay = screen.getByRole('dialog').parentElement!;
    const menuPanel = screen.getByRole('button', { name: 'Move up' }).parentElement!;
    expect(sheetOverlay.className).toContain('z-[60]');
    expect(menuPanel.className).toContain('z-[71]');
  });
});
