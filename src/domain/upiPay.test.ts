import { describe, expect, it } from 'vitest';
import { rupeesToPaise as rs } from './money';
import {
  buildUpiNote,
  buildUpiPayUri,
  clinicCanShowUpiQr,
  clinicUpiPayeeName,
  formatUpiAmountRupees,
  isValidUpiVpa,
  UPI_NOTE_MAX,
} from './upiPay';

describe('isValidUpiVpa', () => {
  it('accepts a typical bank VPA', () => {
    expect(isValidUpiVpa('clinic@okaxis')).toBe(true);
    expect(isValidUpiVpa('  example.clinic@ybl  ')).toBe(true);
  });

  it('rejects blanks and missing handles', () => {
    expect(isValidUpiVpa('')).toBe(false);
    expect(isValidUpiVpa('clinic')).toBe(false);
    expect(isValidUpiVpa('@okaxis')).toBe(false);
  });
});

describe('buildUpiNote', () => {
  it('puts Patient ID and visit date in the UPI note', () => {
    expect(buildUpiNote({ mrno: 'W26-0008', visitDate: '2026-08-18' })).toBe('W26-0008 18/08/26');
  });

  it('adds the patient name when it still fits', () => {
    expect(buildUpiNote({ mrno: 'W26-0008', visitDate: '2026-08-18', patientName: 'Ravi' })).toBe(
      'W26-0008 18/08/26 Ravi'
    );
  });

  it('drops a long name rather than overflowing the NPCI note limit', () => {
    const note = buildUpiNote({
      mrno: 'W26-0008',
      visitDate: '2026-08-18',
      patientName: 'A very long patient name that would overflow the UPI transaction note field',
    });
    expect(note).toBe('W26-0008 18/08/26');
    expect(note.length).toBeLessThanOrEqual(UPI_NOTE_MAX);
  });
});

describe('buildUpiPayUri', () => {
  it('builds an intent with amount, payee, and encoded note', () => {
    const uri = buildUpiPayUri({
      vpa: 'clinic@okaxis',
      payeeName: 'Example Physiotherapy Clinic',
      amountPaise: rs(1000),
      note: 'W26-0008 18/08/26',
    });
    expect(uri).toBe(
      'upi://pay?pa=clinic%40okaxis&pn=Example%20Physiotherapy%20Clinic&am=1000.00&cu=INR&tn=W26-0008%2018%2F08%2F26'
    );
  });
});

describe('formatUpiAmountRupees', () => {
  it('always uses two decimal places', () => {
    expect(formatUpiAmountRupees(rs(500))).toBe('500.00');
    expect(formatUpiAmountRupees(150)).toBe('1.50');
  });
});

describe('clinicCanShowUpiQr', () => {
  it('is off until the clinic enables UPI QR and has a VPA or image', () => {
    expect(clinicCanShowUpiQr({ upiQrEnabled: false, upiVpa: 'clinic@okaxis', upiQrPath: null })).toBe(false);
    expect(clinicCanShowUpiQr({ upiQrEnabled: true, upiVpa: null, upiQrPath: null })).toBe(false);
    expect(clinicCanShowUpiQr({ upiQrEnabled: true, upiVpa: 'clinic@okaxis', upiQrPath: null })).toBe(true);
    expect(clinicCanShowUpiQr({ upiQrEnabled: true, upiVpa: null, upiQrPath: 'c/qr.png' })).toBe(true);
  });
});

describe('clinicUpiPayeeName', () => {
  it('falls back to the clinic name', () => {
    expect(clinicUpiPayeeName({ name: 'Example Physiotherapy Clinic', upiPayeeName: null })).toBe(
      'Example Physiotherapy Clinic'
    );
    expect(clinicUpiPayeeName({ name: 'Example Physiotherapy Clinic', upiPayeeName: 'Front desk' })).toBe(
      'Front desk'
    );
  });
});
