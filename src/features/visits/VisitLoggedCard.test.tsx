// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VisitLoggedCard, type VisitLoggedCardProps } from './VisitLoggedCard';

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className} data-testid="clinical-note-link">
      {children}
    </a>
  ),
}));

afterEach(cleanup);

function renderCard(props: Partial<VisitLoggedCardProps> = {}) {
  const defaultProps: VisitLoggedCardProps = {
    justSaved: {
      visitId: 'visit-123',
      patientId: 'patient-456',
      patientName: 'Eeshaan Sharma',
      patientPhone: '9876543210',
      serviceLabel: 'Physiotherapy Assessment',
      isPackage: false,
      alreadyCollected: true,
      collectedLabel: 'UPI',
      therapistId: 'therapist-789',
      billPaise: 150000,
      visitDate: '2026-10-25',
      mrno: '1042',
    },
    therapistName: 'Dr. Anand',
    paymentDue: 0,
    canBill: true,
    clinicalDocsEnabled: true,
    enablePatientComms: true,
    feedbackRequested: false,
    onRequestFeedback: vi.fn(),
    onTakePayment: vi.fn(),
    onGiveBill: vi.fn(),
    onNewVisitSamePatient: vi.fn(),
    onNewVisitNextPatient: vi.fn(),
    onDone: vi.fn(),
    ...props,
  };

  return { ...render(<VisitLoggedCard {...defaultProps} />), props: defaultProps };
}

describe('VisitLoggedCard', () => {
  it('renders receipt summary with patient, service, date, and therapist', () => {
    renderCard();

    expect(screen.getByRole('heading', { name: 'Visit logged' })).toBeInTheDocument();
    expect(screen.getByText('Eeshaan Sharma')).toBeInTheDocument();
    expect(screen.getByText('Patient ID 1042')).toBeInTheDocument();
    expect(screen.getByText('Physiotherapy Assessment')).toBeInTheDocument();
    expect(screen.getByText('25/10/26')).toBeInTheDocument();
    expect(screen.getByText('Dr. Anand')).toBeInTheDocument();

    const collectedLine = screen.getByTestId('collected-line');
    expect(collectedLine).toHaveTextContent('₹1,500 collected · UPI');
  });

  it('renders payment due badge and take payment button when payment is pending', () => {
    const onTakePayment = vi.fn();
    renderCard({
      paymentDue: 150000,
      justSaved: {
        visitId: 'visit-123',
        patientId: 'patient-456',
        patientName: 'Eeshaan Sharma',
        patientPhone: '9876543210',
        serviceLabel: 'Physiotherapy Assessment',
        isPackage: false,
        alreadyCollected: false,
        therapistId: 'therapist-789',
        billPaise: 150000,
        visitDate: '2026-10-25',
        mrno: '1042',
      },
      onTakePayment,
    });

    expect(screen.getByText('Payment due · ₹1,500')).toBeInTheDocument();
    const takePaymentBtn = screen.getByRole('button', { name: /Take payment · ₹1,500/ });
    expect(takePaymentBtn).toBeInTheDocument();
    fireEvent.click(takePaymentBtn);
    expect(onTakePayment).toHaveBeenCalledTimes(1);
  });

  it('shows clinical docs link when enabled, and hides when disabled', () => {
    const { rerender, props } = renderCard({ clinicalDocsEnabled: true });
    expect(screen.getByTestId('clinical-note-link')).toHaveTextContent('Add clinical note');

    rerender(<VisitLoggedCard {...props} clinicalDocsEnabled={false} />);
    expect(screen.queryByTestId('clinical-note-link')).not.toBeInTheDocument();
  });

  it('handles give bill button', () => {
    const onGiveBill = vi.fn();
    renderCard({ canBill: true, onGiveBill });

    const billBtn = screen.getByRole('button', { name: 'Give bill' });
    fireEvent.click(billBtn);
    expect(onGiveBill).toHaveBeenCalledTimes(1);
  });

  it('handles feedback / review button states', () => {
    const onRequestFeedback = vi.fn();
    const { rerender, props } = renderCard({
      enablePatientComms: true,
      feedbackRequested: false,
      onRequestFeedback,
    });

    const reviewBtn = screen.getByRole('button', { name: 'Request review' });
    fireEvent.click(reviewBtn);
    expect(onRequestFeedback).toHaveBeenCalledTimes(1);

    rerender(<VisitLoggedCard {...props} feedbackRequested={true} />);
    expect(screen.getByRole('button', { name: 'Review requested ✓' })).toBeDisabled();
  });

  it('calls onNewVisitSamePatient when clicking another visit for same patient', () => {
    const onNewVisitSamePatient = vi.fn();
    renderCard({ onNewVisitSamePatient });

    const btn = screen.getByRole('button', { name: 'Another visit for Eeshaan' });
    fireEvent.click(btn);
    expect(onNewVisitSamePatient).toHaveBeenCalledTimes(1);
  });

  it('calls onNewVisitNextPatient when clicking log visit for next patient', () => {
    const onNewVisitNextPatient = vi.fn();
    renderCard({ onNewVisitNextPatient });

    const btn = screen.getByRole('button', { name: 'Log visit for next patient' });
    fireEvent.click(btn);
    expect(onNewVisitNextPatient).toHaveBeenCalledTimes(1);
  });

  it('calls onDone when clicking Done button at the bottom', () => {
    const onDone = vi.fn();
    renderCard({ onDone });

    const doneBtn = screen.getByRole('button', { name: 'Done' });
    fireEvent.click(doneBtn);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  describe('one solid button at a time', () => {
    const solid = (el: HTMLElement) => el.className.includes('bg-[var(--teal)]');
    const base = {
      justSaved: {
        visitId: 'v', patientId: 'p', patientName: 'Eeshaan Sharma', patientPhone: null, serviceLabel: 'Assessment',
        isPackage: false, alreadyCollected: false, therapistId: 't', billPaise: 150000, visitDate: '2026-10-25', mrno: '1042',
      },
    };

    it('payment owed: only Take payment is solid', () => {
      renderCard({ ...base, paymentDue: 150000 });
      expect(solid(screen.getByRole('button', { name: /Take payment/ }))).toBe(true);
      expect(solid(screen.getByTestId('clinical-note-link'))).toBe(false);
    });

    it('nothing owed: the note is solid, Give bill is not', () => {
      renderCard({ justSaved: { ...base.justSaved, alreadyCollected: true } });
      expect(solid(screen.getByTestId('clinical-note-link'))).toBe(true);
      expect(solid(screen.getByRole('button', { name: /Give bill/ }))).toBe(false);
    });

    it('no clinical notes: Give bill is the solid one', () => {
      renderCard({ justSaved: { ...base.justSaved, alreadyCollected: true }, clinicalDocsEnabled: false });
      expect(solid(screen.getByRole('button', { name: /Give bill/ }))).toBe(true);
    });
  });

  it('does not say "Settled" for a visit billed elsewhere', () => {
    renderCard({
      justSaved: {
        visitId: 'v', patientId: 'p', patientName: 'Eeshaan Sharma', patientPhone: null, serviceLabel: 'Assessment',
        isPackage: false, alreadyCollected: false, therapistId: 't', billPaise: 150000, visitDate: '2026-10-25', mrno: '1042',
      },
    });
    expect(screen.queryByText('Settled')).toBeNull();
    expect(screen.getByText('Billing handled separately')).toBeInTheDocument();
  });

  it('calls onEdit when the Edit button is clicked', () => {
    const onEdit = vi.fn();
    renderCard({ onEdit });
    const editBtn = screen.getByRole('button', { name: 'Edit visit' });
    expect(editBtn).toBeInTheDocument();
    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

