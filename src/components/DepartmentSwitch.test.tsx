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
const twoPlaceClinic = { id: 'c2', careLocations: ['clinic', 'home'] } as unknown as Clinic;
const singleClinic = { id: 'c3', careLocations: ['clinic'] } as unknown as Clinic;

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

  it('renders segmented toggle for desktop when clinic has 2 places', () => {
    render(
      <DepartmentProvider clinic={twoPlaceClinic} userId="u1" role="admin" departments={null}>
        <DepartmentSwitch />
      </DepartmentProvider>
    );

    expect(screen.getByRole('group', { name: 'Place switch' })).toBeInTheDocument();
    const opButton = screen.getAllByRole('button', { name: 'OP' }).find((b) => b.getAttribute('aria-pressed') !== null);
    expect(opButton).toHaveAttribute('aria-pressed', 'true');
    const homeButton = screen.getAllByRole('button', { name: 'Home' }).find((b) => b.getAttribute('aria-pressed') !== null);
    expect(homeButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('shifts to compact dropdown everywhere when clinic has 3 places (OP, Home, IP)', () => {
    render(
      <DepartmentProvider clinic={multiClinic} userId="u1" role="admin" departments={null}>
        <DepartmentSwitch />
      </DepartmentProvider>
    );

    expect(screen.queryByRole('group', { name: 'Place switch' })).not.toBeInTheDocument();
    const trigger = screen.getByRole('button', { name: /Place: OP\. Switch place/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  });

  it('opens dropdown menu, lists all visible places, switches place, and closes', async () => {
    render(
      <DepartmentProvider clinic={multiClinic} userId="u1" role="admin" departments={null}>
        <DepartmentSwitch />
      </DepartmentProvider>
    );

    const trigger = screen.getByRole('button', { name: /Place: OP\. Switch place/ });
    await act(async () => {
      fireEvent.click(trigger);
    });

    const menu = screen.getByRole('menu', { name: /Switch place/ });
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /Outpatient \(OP\)/ })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /Home care/ })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('menuitemradio', { name: /Inpatient \(IP\)/ })).toHaveAttribute('aria-checked', 'false');

    await act(async () => {
      fireEvent.keyDown(menu, { key: 'Escape' });
    });
    expect(screen.queryByRole('menu', { name: /Switch place/ })).not.toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Place: OP\. Switch place/ }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Home care/ }));
    });

    await waitFor(() => {
      expect(screen.queryByRole('menu', { name: /Switch place/ })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Place: Home\. Switch place/ })).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Place: Home\. Switch place/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Inpatient \(IP\)/ }));
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
