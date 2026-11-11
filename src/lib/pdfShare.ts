/**
 * Renders a DOM node — the same content the browser's own "Print / Save
 * PDF" button shows, in colour — into a paginated PDF entirely on-device, no server
 * round trip, consistent with this app's offline-first design. `paper`
 * matches the page's own A4/A5 toggle so the shared file matches what
 * printing would produce. `scale: 2` renders at roughly double CSS pixel
 * density before downscaling into the PDF, so text stays legible when the
 * recipient zooms in on a phone screen — html2canvas rasterizes the node
 * (there's no way to get real selectable text out of arbitrary DOM without
 * reimplementing the whole layout in jsPDF's own drawing API), so this is
 * the ceiling on sharpness available without that.
 *
 * jsPDF + html2canvas are dynamically imported here rather than at module
 * top level — together they're a ~180KB-gzipped chunk, and every print page
 * that could ever call this loads this module; eagerly bundling them would
 * mean everyone downloads that weight just to view an invoice, whether or
 * not they ever click Share.
 */
import { notify } from '@/lib/notify';
import { activeCountryCode } from '@/domain/clinicRuntime';
import { splitPhone } from '@/domain/countryCodes';
const PAGE = {
  A4: { widthMm: 210, heightMm: 297, widthPx: 794, heightPx: 1123, padXPx: 48, padYPx: 45 },
  A5: { widthMm: 148, heightMm: 210, widthPx: 559, heightPx: 794, padXPx: 36, padYPx: 36 },
} as const;

export interface PageSlice {
  from: number;
  to: number;
}

/**
 * Where to cut one tall rendered document into pages, in CSS pixels, so no row or block is sliced in half. A document
 * that fits stays whole. `blocks` are the things that must not split (table rows, the totals, the signature block);
 * the first page already carries its own top margin, and later pages get `margin` added at the top when drawn.
 */
export function computePageSlices(
  blocks: { top: number; bottom: number }[],
  totalHeight: number,
  pageHeight: number,
  margin: number
): PageSlice[] {
  if (totalHeight <= pageHeight + 2) return [{ from: 0, to: totalHeight }];
  const slices: PageSlice[] = [];
  let from = 0;
  while (from < totalHeight) {
    const limit = from + (from === 0 ? pageHeight - margin : pageHeight - 2 * margin);
    if (limit >= totalHeight) {
      slices.push({ from, to: totalHeight });
      break;
    }
    const straddling = blocks.filter((b) => b.top > from && b.top < limit && b.bottom > limit);
    const to = straddling.length > 0 ? Math.min(...straddling.map((b) => b.top)) : limit;
    slices.push({ from, to });
    from = to;
  }
  return slices;
}

/**
 * An off-screen copy of the document laid out as one fixed page, whatever the viewer's screen. The on-screen node can't
 * be used directly: its width follows the device and its `min-h-[calc(100vh-80px)]` follows the screen height, which
 * could spill a short bill onto a second page on a tall tablet.
 */
function offscreenCopy(element: HTMLElement, paper: 'A4' | 'A5'): { copy: HTMLElement; remove: () => void } {
  const page = PAGE[paper];
  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  Object.assign(holder.style, { position: 'absolute', left: '-10000px', top: '0', width: `${page.widthPx}px` });
  const copy = element.cloneNode(true) as HTMLElement;
  Object.assign(copy.style, {
    width: `${page.widthPx}px`,
    maxWidth: 'none',
    minHeight: `${page.heightPx}px`,
    margin: '0',
    padding: `${page.padYPx}px ${page.padXPx}px`,
    boxSizing: 'border-box',
  });
  copy.querySelectorAll<HTMLElement>('.overflow-x-auto').forEach((el) => {
    el.style.overflow = 'visible';
  });
  copy.querySelectorAll<HTMLElement>('table').forEach((el) => {
    el.style.minWidth = '0';
  });
  holder.appendChild(copy);
  document.body.appendChild(holder);
  return { copy, remove: () => holder.remove() };
}

export async function renderElementToPdf(
  element: HTMLElement,
  fileName: string,
  paper: 'A4' | 'A5' = 'A4'
): Promise<File> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);
  const page = PAGE[paper];
  const { copy, remove } = offscreenCopy(element, paper);
  try {
    await document.fonts?.ready;
    await Promise.all(Array.from(copy.querySelectorAll('img')).map((img) => img.decode().catch(() => undefined)));

    const origin = copy.getBoundingClientRect().top;
    const blocks = Array.from(copy.querySelectorAll('tr, [data-pdf-block]')).map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top - origin, bottom: r.bottom - origin };
    });
    const totalHeight = copy.offsetHeight;

    const canvas = await html2canvas(copy, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      windowWidth: 900,
    });

    const pdf = new jsPDF({ unit: 'mm', format: paper.toLowerCase() as 'a4' | 'a5' });
    const pxToCanvas = canvas.height / totalHeight;
    const pxToMm = page.widthMm / page.widthPx;
    computePageSlices(blocks, totalHeight, page.heightPx, page.padYPx).forEach((slice, i) => {
      const piece = document.createElement('canvas');
      piece.width = canvas.width;
      piece.height = Math.round((slice.to - slice.from) * pxToCanvas);
      piece.getContext('2d')?.drawImage(canvas, 0, -Math.round(slice.from * pxToCanvas));
      if (i > 0) pdf.addPage();
      pdf.addImage(
        piece.toDataURL('image/jpeg', 0.92),
        'JPEG',
        0,
        i === 0 ? 0 : page.padYPx * pxToMm,
        page.widthMm,
        Math.min((slice.to - slice.from) * pxToMm, page.heightMm)
      );
    });
    return new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
  } finally {
    remove();
  }
}

type FileSharingNavigator = Navigator & {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
};

/** Whether this browser can hand a file to the system share sheet (phones and tablets, mainly; not most desktops). */
export function canShareFiles(): boolean {
  const nav = navigator as FileSharingNavigator;
  if (!nav.share || !nav.canShare) return false;
  try {
    return nav.canShare({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] });
  } catch {
    return false;
  }
}

/**
 * Hands the PDF to the share sheet, so WhatsApp can receive the actual file. Must run straight after a tap: browsers
 * refuse it once that tap has gone stale (`needs-tap`), and the caller then asks for one more tap. It never silently
 * degrades to a text message, which is how bills used to reach patients as a line of text with no bill attached.
 */
export async function shareBillFile(
  file: File,
  title: string
): Promise<'shared' | 'cancelled' | 'needs-tap' | 'failed'> {
  const nav = navigator as FileSharingNavigator;
  try {
    await nav.share?.({ files: [file], title });
    return 'shared';
  } catch (e) {
    const name = e instanceof Error ? e.name : '';
    if (name === 'AbortError') return 'cancelled';
    if (name === 'NotAllowedError') return 'needs-tap';
    console.warn('Could not share the bill file:', e);
    return 'failed';
  }
}

/** Saves the file to the device (desktop, where a file can't be passed to WhatsApp). */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Opens WhatsApp with a message; with no phone on file, the person picks the chat there. */
export function openWhatsAppWithText(text: string, toPhone?: string | null): boolean {
  return openWhatsAppUrl(buildWhatsAppSendUrl(text, toPhone), text);
}

/** Same entry as visit-row "Send WhatsApp reminder" — direct wa.me, no blank tab. */
export function openPatientWhatsAppChat(
  text: string,
  patientPhone: string | null | undefined
): void {
  const normalized = patientPhone ? normalizePhoneForWaMe(patientPhone) : '';
  if (!normalized) {
    notify.error('Patient has no phone number on file');
    return;
  }
  const url = buildWhatsAppSendUrl(text, normalized);
  openWhatsAppUrl(url, text);
}

/**
 * Digits for a wa.me link; the same normalization as visit-row payment reminders and Meta's `to` field. A number
 * that carries its own code ("+65 91234567", or "0065..." typed with the international prefix) keeps it, whatever
 * its length; a bare number takes the clinic's country code. `splitPhone` is the one place stored numbers are read.
 */
export function normalizePhoneForWaMe(phone: string, defaultCountryCode: string = activeCountryCode()): string {
  const compact = phone.trim().replace(/[\s\-()]/g, '');
  if (!/\d/.test(compact)) return '';
  const { code, national } = splitPhone(compact.replace(/^00/, '+'), defaultCountryCode);
  return `${code}${national}`.replace(/\D/g, '');
}

/** `tel:` link for a stored number, with the country code once (a doubled "+91 +91" would not dial). */
export function telHref(phone: string): string {
  const digits = normalizePhoneForWaMe(phone);
  return digits ? `tel:+${digits}` : `tel:${phone}`;
}

export function buildWhatsAppSendUrl(text: string, toPhone?: string | null): string {
  const waPhone = toPhone ? normalizePhoneForWaMe(toPhone) : '';
  return waPhone
    ? `https://wa.me/${waPhone}?text=${encodeURIComponent(text)}`
    : `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** When wa.me cannot open (popup blocker or tab closed), copy text for manual paste. */
export function notifyWhatsAppOpenFailed(shareText: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(shareText).catch(() => {});
  }
  notify.error(
    'Could not open WhatsApp automatically — your browser may be blocking pop-ups. ' +
      'The message was copied to your clipboard; open WhatsApp, pick the patient, and paste. ' +
      'Or allow pop-ups for this site and try again.'
  );
}

function openWhatsAppUrl(
  url: string,
  clipboardText: string
): boolean {
  let opened: Window | null = null;
  try {
    // Note: Do NOT pass 'noopener,noreferrer' in the 3rd argument (windowFeatures)
    // because per the WHATWG HTML specification, window.open returns null whenever
    // noopener is present in windowFeatures, causing compliant browsers to falsely
    // trigger popup blocker detection. Modern browsers isolate cross-origin _blank
    // targets by default, and we disown opener explicitly below.
    opened = window.open(url, '_blank');
  } catch {
    opened = null;
  }
  if (opened) {
    try {
      opened.opener = null;
    } catch {
      // Ignore cross-origin security restrictions if opener property is protected
    }
    return true;
  }
  notifyWhatsAppOpenFailed(clipboardText);
  return false;
}

/**
 * Opens WhatsApp with a pre-filled message — identical to payment reminders.
 */
export function openWhatsAppChat(text: string, toPhone?: string | null): boolean {
  if (!toPhone?.trim()) {
    notifyWhatsAppOpenFailed(text);
    return false;
  }
  const url = buildWhatsAppSendUrl(text, toPhone);
  return openWhatsAppUrl(url, text);
}

export async function shareTextViaWhatsApp(
  text: string,
  _title: string,
  _popup?: Window | null,
  toPhone?: string | null
): Promise<void> {
  openWhatsAppChat(text, toPhone);
}
