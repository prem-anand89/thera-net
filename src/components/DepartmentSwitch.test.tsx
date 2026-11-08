// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { db } from '@/lib/db';
import type { Clinic } from '@/domain/types';
import { DepartmentProvider } from '@/app/DepartmentContext';
import { DepartmentSwitch, DepartmentBand } from './DepartmentSwitch';

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

  it('renders desktop segmented control with aria-pressed on the active department', () => {
    render(
      <DepartmentProvider clinic={multiClinic} userId="u1" role="admin" departments={null}>
        <DepartmentSwitch />
      </DepartmentProvider>
    );

    const opButtons = screen.getAllByRole('button', { name: 'OP' });
    const opSegment = opButtons.find((b) => b.getAttribute('aria-pressed') !== null);
    expect(opSegment).toHaveAttribute('aria-pressed', 'true');

    const homeButtons = screen.getAllByRole('button', { name: 'Home care' });
    const homeSegment = homeButtons.find((b) => b.getAttribute('aria-pressed') !== null);
    expect(homeSegment).toHaveAttribute('aria-pressed', 'false');

    const ipButtons = screen.getAllByRole('button', { name: 'IP' });
    const ipSegment = ipButtons.find((b) => b.getAttribute('aria-pressed') !== null);
    expect(ipSegment).toHaveAttribute('aria-pressed', 'false');
  });

  it('clicking a department switches the active department', async () => {
    render(
      <DepartmentProvider clinic={multiClinic} userId="u1" role="admin" departments={null}>
        <DepartmentSwitch />
      </DepartmentProvider>
    );

    const homeButtons = screen.getAllByRole('button', { name: 'Home care' });
    const homeSegment = homeButtons.find((b) => b.getAttribute('aria-pressed') !== null);
    expect(homeSegment).toBeDefined();

    await act(async () => {
      fireEvent.click(homeSegment!);
    });

    await waitFor(() => {
      const updatedHome = screen.getAllByRole('button', { name: 'Home care' }).find((b) => b.getAttribute('aria-pressed') !== null);
      expect(updatedHome).toHaveAttribute('aria-pressed', 'true');
    });

    const opButtons = screen.getAllByRole('button', { name: 'OP' });
    const opSegment = opButtons.find((b) => b.getAttribute('aria-pressed') !== null);
    expect(opSegment).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens mobile menu, allows choosing a department, and closes', async () => {
    render(
      <DepartmentProvider clinic={multiClinic} userId="u1" role="admin" departments={null}>
        <DepartmentSwitch />
      </DepartmentProvider>
    );

    const mobileTrigger = screen.getByRole('button', { name: /Department: OP\. Switch department/ });
    expect(mobileTrigger).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(mobileTrigger);
    });

    const menu = screen.getByRole('menu', { name: /Switch department/ });
    expect(menu).toBeInTheDocument();

    const ipMenuItem = screen.getByRole('menuitem', { name: /IP/ });
    await act(async () => {
      fireEvent.click(ipMenuItem);
    });

    await waitFor(() => {
      expect(screen.queryByRole('menu', { name: /Switch department/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Department: IP\. Switch department/ })).toBeInTheDocument();
    });
  });
});

describe('DepartmentBand', () => {
  beforeEach(async () => {
    await db.meta.clear();
  });
  afterEach(cleanup);

  it('renders nothing when canSwitch is false', () => {
    const { container } = render(
      <DepartmentProvider clinic={singleClinic} userId="u1" role="admin" departments={null}>
        <DepartmentBand />
      </DepartmentProvider>
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the appropriate color band for active department when canSwitch is true', async () => {
    const { container } = render(
      <DepartmentProvider clinic={multiClinic} userId="u1" role="admin" departments={null}>
        <DepartmentBand />
        <DepartmentSwitch />
      </DepartmentProvider>
    );

    expect(container.querySelector('.bg-\\[var\\(--teal\\)\\]')).toBeInTheDocument();

    const homeButtons = screen.getAllByRole('button', { name: 'Home care' });
    const homeSegment = homeButtons.find((b) => b.getAttribute('aria-pressed') !== null);
    await act(async () => {
      fireEvent.click(homeSegment!);
    });

    await waitFor(() => {
      expect(container.querySelector('.bg-\\[var\\(--sky\\)\\]')).toBeInTheDocument();
    });

    const ipButtons = screen.getAllByRole('button', { name: 'IP' });
    const ipSegment = ipButtons.find((b) => b.getAttribute('aria-pressed') !== null);
    await act(async () => {
      fireEvent.click(ipSegment!);
    });

    await waitFor(() => {
      expect(container.querySelector('.bg-\\[var\\(--plum\\)\\]')).toBeInTheDocument();
    });
  });
});
