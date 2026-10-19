// pdf.js positioned text extraction (SPEC §12.2). pdf.js is injected so the
// same code runs in the browser (lazy-loaded, self-hosted worker) and in Node tests.
import type { Page, TextItem } from './types';

export interface PdfPageLike {
  getViewport(o: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{ items: unknown[] }>;
}
export interface PdfDocLike {
  numPages: number;
  getPage(n: number): Promise<PdfPageLike>;
}

type PdfTextItem = { str: string; transform: number[]; width: number; height: number };

/** Glyphs pdf.js couldn't map to Unicode: fonts with a custom encoding and no ToUnicode table. */
const UNMAPPED = /[\p{Cc}\uFFFD]/gu;

/**
 * Positioned text per page, and how many readable characters it holds. A text
 * layer that is mostly unmapped glyph codes (control characters) counts as none,
 * so the file is read like a scan.
 */
export async function pdfTextPages(doc: PdfDocLike): Promise<{ pages: Page[]; chars: number }> {
  const pages: Page[] = [];
  let chars = 0;
  let unmapped = 0;
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { height } = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const raw of content.items as PdfTextItem[]) {
      if (typeof raw.str !== 'string' || !raw.str.trim()) continue;
      const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = raw.transform;
      const h = raw.height || Math.hypot(c, d) || Math.hypot(a, b);
      const visible = raw.str.replace(/\s/g, '');
      unmapped += visible.match(UNMAPPED)?.length ?? 0;
      chars += visible.replace(UNMAPPED, '').length;
      // pdf.js y is the baseline from the bottom; flip to top-down. Labcorp prints
      // ranges and names with U+2212 MINUS SIGN ("0.450 − 4.500", "25−Hydroxy").
      items.push({ str: raw.str.replace(/\u2212/g, '-'), x: e, y: height - f, w: raw.width, h, page: n });
    }
    pages.push({ page: n, items });
  }
  return { pages, chars: unmapped > 0.1 * (chars + unmapped) ? 0 : chars };
}

/** No usable text layer: fewer than ~40 characters per page means a scan. */
export const looksScanned = (chars: number, numPages: number) => chars < 40 * Math.max(1, numPages);
