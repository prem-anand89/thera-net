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

/**
 * Same Web-Share-API-with-`wa.me`-fallback shape as `shareFileToWhatsApp`,
 * for a plain link/text payload with no file involved (e.g. a patient
 * feedback link) — most of the app's "share this" actions have nothing to
 * attach, so this is the common case, not `shareFileToWhatsApp`'s.
 */
export async function shareTextViaWhatsApp(text: string, title: string): Promise<void> {
  const nav = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ text, title });
      return;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      // Fall through to the wa.me link for any other Web Share failure —
      // same reasoning shareFileToWhatsApp falls back rather than erroring.
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
}
