import type { Paise } from './money';

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

function belowThousand(n: number): string {
  if (n === 0) return '';
  if (n < 20) return ONES[n];
  if (n < 100) return `${TENS[Math.floor(n / 10)]}${n % 10 ? ' ' + ONES[n % 10] : ''}`;
  return `${ONES[Math.floor(n / 100)]} Hundred${n % 100 ? ' ' + belowThousand(n % 100) : ''}`;
}

/**
 * Indian numbering system (thousand, lakh, crore — not million/billion):
 * 12,34,56,789 -> Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven
 * Hundred Eighty Nine.
 */
function rupeesInWords(rupees: number): string {
  if (rupees === 0) return 'Zero';
  const crore = Math.floor(rupees / 1_00_00_000);
  const lakh = Math.floor((rupees % 1_00_00_000) / 1_00_000);
  const thousand = Math.floor((rupees % 1_00_000) / 1_000);
  const hundred = rupees % 1_000;

  const parts: string[] = [];
  if (crore) parts.push(`${belowThousand(crore)} Crore`);
  if (lakh) parts.push(`${belowThousand(lakh)} Lakh`);
  if (thousand) parts.push(`${belowThousand(thousand)} Thousand`);
  if (hundred) parts.push(belowThousand(hundred));
  return parts.join(' ');
}

/** "Rupees Twelve Thousand Three Hundred Only" / "...and Fifty Paise Only". */
export function amountInWords(amountPaise: Paise): string {
  const rupees = Math.floor(amountPaise / 100);
  const paise = amountPaise % 100;
  const rupeeWords = rupeesInWords(rupees);
  const paiseWords = paise > 0 ? ` and ${belowThousand(paise)} Paise` : '';
  return `Rupees ${rupeeWords}${paiseWords} Only`;
}
