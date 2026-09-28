/**
 * Renders a DOM node — the same content the browser's own "Print / Save
 * PDF" button shows — into a paginated PDF entirely on-device, no server
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
export async function renderElementToPdf(
  element: HTMLElement,
  fileName: string,
  paper: 'A4' | 'A5' = 'A4'
): Promise<File> {
  const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
    import('jspdf'),
    import('html2canvas'),
  ]);
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#ffffff',
    // Without this, html2canvas lays the cloned document out at whatever
    // width the *viewer's* screen happens to be — on a phone that's the
    // same narrow layout the on-screen page uses (line-item tables
    // scrolling horizontally, etc.), so the shared PDF would inherit
    // whatever's actually visible in that narrow viewport rather than the
    // full, properly-laid-out document. Forcing a desktop-width window
    // here means the shared file always renders the same way regardless
    // of which device issued it.
    windowWidth: 900,
  });

  const pageWidthMm = paper === 'A4' ? 210 : 148;
  const pageHeightMm = paper === 'A4' ? 297 : 210;
  const imgWidthMm = pageWidthMm;
  const imgHeightMm = (canvas.height * imgWidthMm) / canvas.width;
  const imgData = canvas.toDataURL('image/jpeg', 0.92);

  const pdf = new jsPDF({ unit: 'mm', format: paper.toLowerCase() as 'a4' | 'a5' });

  // One long image sliced across as many pages as it takes — each page
  // paints the same full image shifted up by one page-height, so only the
  // slice inside that page's own bounds ends up visible (jsPDF clips to
  // the page automatically).
  let heightLeftMm = imgHeightMm;
  let positionMm = 0;
  pdf.addImage(imgData, 'JPEG', 0, positionMm, imgWidthMm, imgHeightMm);
  heightLeftMm -= pageHeightMm;
  while (heightLeftMm > 0) {
    positionMm -= pageHeightMm;
    pdf.addPage();
    pdf.addImage(imgData, 'JPEG', 0, positionMm, imgWidthMm, imgHeightMm);
    heightLeftMm -= pageHeightMm;
  }

  return new File([pdf.output('blob')], fileName, { type: 'application/pdf' });
}

/**
 * Web Share API's `files` support is what makes WhatsApp (and every other
 * installed app) show up as a share target with the actual PDF attached —
 * but it's mobile-browser-only (recent Chrome/Android, Safari/iOS) and
 * unavailable on desktop. Where it's not supported, falls back to a
 * `wa.me` deep link with just a text summary — WhatsApp's own click-to-chat
 * scheme has no way to carry a file, so the fallback is deliberately
 * text-only rather than silently doing nothing.
 */
export async function shareFileToWhatsApp(
  file: File,
  title: string,
  fallbackText: string
): Promise<'shared' | 'fallback'> {
  const nav = navigator as Navigator & {
    share?: (data: ShareData) => Promise<void>;
    canShare?: (data: ShareData) => boolean;
  };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title });
      return 'shared';
    } catch (e) {
      // AbortError = the user backed out of the share sheet — not a
      // failure worth surfacing as an error.
      if (e instanceof Error && e.name === 'AbortError') return 'shared';
      throw e;
    }
  }
  window.open(
    `https://wa.me/?text=${encodeURIComponent(fallbackText)}`,
    '_blank',
    'noopener,noreferrer'
  );
  return 'fallback';
}

export type OpenPatientWhatsAppOptions = {
  /**
   * Use after async work (e.g. `create_feedback_request`): if a new tab is
   * blocked, open wa.me in this tab — same end result as payment reminders.
   */
  navigateCurrentTabIfBlocked?: boolean;
};

/** Same entry as visit-row "Send WhatsApp reminder" — direct wa.me, no blank tab. */
export function openPatientWhatsAppChat(
  text: string,
  patientPhone: string | null | undefined,
  options?: OpenPatientWhatsAppOptions
): void {
  if (!patientPhone?.trim()) {
    alert('Patient has no phone number on file');
    return;
  }
  const url = buildWhatsAppSendUrl(text, patientPhone);
  openWhatsAppUrl(url, text, options?.navigateCurrentTabIfBlocked ?? false);
}

/** Same normalization as visit-row payment reminders and Meta's `to` field. */
export function normalizePhoneForWaMe(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
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
  alert(
    'Could not open WhatsApp automatically — your browser may be blocking pop-ups. ' +
      'The message was copied to your clipboard; open WhatsApp, pick the patient, and paste. ' +
      'Or allow pop-ups for this site and try again.'
  );
}

function openWhatsAppUrl(
  url: string,
  clipboardText: string,
  navigateCurrentTabIfBlocked: boolean
): void {
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (opened && !opened.closed) return;

  // Fallback: synthesised click on an anchor, sometimes clears the blocker
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  link.remove();

  notifyWhatsAppOpenFailed(clipboardText);
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
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    notifyWhatsAppOpenFailed(text);
    return false;
  }
  return true;
}

export async function shareTextViaWhatsApp(
  text: string,
  _title: string,
  _popup?: Window | null,
  toPhone?: string | null
): Promise<void> {
  openWhatsAppChat(text, toPhone);
}
