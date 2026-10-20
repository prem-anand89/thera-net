// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Patient } from '@/domain/types';
import { SimilarPatients } from './SimilarPatients';

const patient: Patient = {
  id: 'p1', clinicId: 'c', mrno: 'BM-42', mrnoSource: 'auto', name: 'Priya Sharma', age: 34, sex: 'F', phone: null,
  primaryCondition: 'Ankle sprain', updatedAt: '',
};

describe('SimilarPatients', () => {
  afterEach(cleanup);

  it('shows what tells them apart and offers Use this patient and Different person', () => {
    const onUse = vi.fn();
    const onDifferent = vi.fn();
    render(
      <SimilarPatients matches={[{ patient, matchedBy: 'name', score: 1 }]} lastVisitOn={new Map([['p1', '2026-10-12']])} onUse={onUse} onDifferent={onDifferent} differentConfirmed={false} />
    );
    expect(screen.getByText('BM-42 · 34 F · Ankle sprain · seen 12 Oct')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Use this patient' }));
    expect(onUse).toHaveBeenCalledWith(patient);
    fireEvent.click(screen.getByRole('button', { name: 'Different person' }));
    expect(onDifferent).toHaveBeenCalled();
  });

  it('names a phone match, and renders nothing without matches or once resolved to a different person', () => {
    const { container, rerender } = render(
      <SimilarPatients matches={[{ patient, matchedBy: 'phone', score: 1 }]} onUse={vi.fn()} onDifferent={vi.fn()} differentConfirmed={false} />
    );
    expect(screen.getByText(/phone number is already on file/)).toBeInTheDocument();
    expect(screen.getByText('same phone')).toBeInTheDocument();
    rerender(<SimilarPatients matches={[]} onUse={vi.fn()} onDifferent={vi.fn()} differentConfirmed={false} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SimilarPatients matches={[{ patient, matchedBy: 'name', score: 1 }]} onUse={vi.fn()} onDifferent={vi.fn()} differentConfirmed />);
    expect(screen.queryByRole('button', { name: 'Use this patient' })).toBeNull();
  });
});
