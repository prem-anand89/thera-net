// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '@/lib/db';
import type { Clinic } from '@/domain/types';
import { DepartmentProvider } from '@/app/DepartmentContext';
import { DepartmentSwitch, DepartmentPill } from './DepartmentSwitch';

const multiClinic = { id: 'c1', careLocations: ['clinic', 'home', 'ward'] } as unknown as Clinic;
const singleClinic = { id: 'c2', careLocations: ['clinic'] } as unknown as Clinic;

describe('DepartmentSwitch', () => {
  beforeEach(async () => {
    await db.meta.clear();
  });
  afterEach(cleanup);

  it('renders nothing when canSwitch is false', () => {
    const { container } = render(
      <DepartmentProvider clinic={singleClinic} userId="u1" role="admin" departments={null}>
        <DepartmentSwitch />
      </DepartmentProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders desktop segmented control with aria-pressed on the active place', () => {
    render(
      <DepartmentProvider clinic={multiClinic} userId="u1" role="admin" departments={null}>
        <DepartmentSwitch />
      </DepartmentProvider>
    );

    const opButtons = screen.getAllByRole('button', { name: 'OP' });
    const opSegment = opButtons.find((b) => b.getAttribute('aria-pressed') !== null);
    expect(opSegment).toHaveAttribute('aria-pressed', 'true');

    const homeButtons = screen.getAllByRole('button', { name: 'Home' });
    const homeSegment = homeButtons.find((b) => b.getAttribute('aria-pressed') !== null);
    expect(homeSegment).toHaveAttribute('aria-pressed', 'false');

    const ipButtons = screen.getAllByRole('button', { name: 'IP' });
    const ipSegment = ipButtons.find((b) => b.getAttribute('aria-pressed') !== null);
    expect(ipSegment).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a place switches the active place', async () => {
    render(
      <DepartmentProvider clinic={multiClinic} userId="u1" role="admin" departments={null}>
        <DepartmentSwitch />
      </DepartmentProvider>
    );

    const homeButtons = screen.getAllByRole('button', { name: 'Home' });
    const homeSegment = homeButtons.find((b) => b.getAttribute('aria-pressed') !== null);
    expect(homeSegment).toBeDefined();

    await act(async () => {
      fireEvent.click(homeSegment!);
    });

    await waitFor(() => {
      const updatedHome = screen.getAllByRole('button', { name: 'Home' }).find((b) => b.getAttribute('aria-pressed') !== null);
      expect(updatedHome).toHaveAttribute('aria-pressed', 'true');
    });

    const opButtons = screen.getAllByRole('button', { name: 'OP' });
    const opSegment = opButtons.find((b) => b.getAttribute('aria-pressed') !== null);
    expect(opSegment).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens mobile menu, allows choosing a place, and closes', async () => {
    render(
      <DepartmentProvider clinic={multiClinic} userId="u1" role="admin" departments={null}>
        <DepartmentSwitch />
      </DepartmentProvider>
    );

    const mobileTrigger = screen.getByRole('button', { name: /Place: OP\. Switch place/ });
    expect(mobileTrigger).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(mobileTrigger);
    });

    const menu = screen.getByRole('menu', { name: /Switch place/ });
    expect(menu).toBeInTheDocument();

    const ipMenuItem = screen.getByRole('menuitem', { name: /IP/ });
    await act(async () => {
      fireEvent.click(ipMenuItem);
    });

    await waitFor(() => {
      expect(screen.queryByRole('menu', { name: /Switch place/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Place: IP\. Switch place/ })).toBeInTheDocument();
    });
  });
});

describe('DepartmentPill', () => {
  afterEach(cleanup);

  it('renders the active department label or full name with corresponding tone', () => {
    const { rerender } = render(
      <DepartmentProvider clinic={multiClinic} userId="u1" role="admin" departments={null}>
        <DepartmentPill />
      </DepartmentProvider>
    );
    expect(screen.getByText('OP')).toBeInTheDocument();

    rerender(
      <DepartmentProvider clinic={multiClinic} userId="u1" role="admin" departments={null}>
        <DepartmentPill full />
      </DepartmentProvider>
    );
    expect(screen.getByText('Outpatient (OP)')).toBeInTheDocument();
  });

  it('renders explicit department when provided', () => {
    render(<DepartmentPill department="home" full />);
    expect(screen.getByText('Home care')).toBeInTheDocument();
  });
});
