// One uploaded file → ExtractedReport. Environment-specific pieces (pdf.js,
// rendering, OCR) are injected so this runs in the browser and in Node tests.
import type { Dictionary } from '@labkit/core';
import { strFromU8 } from 'fflate';
import { extractReport, type ExtractedReport } from './extract';
import { expandZip, sniff } from './intake';
import { textToPage } from './layout';
import { looksScanned, pdfTextPages, type PdfDocLike } from './pdftext';
import type { Method, Page } from './types';

export class UnsupportedFileError extends Error {}

export type ParseDeps = {
  dictionary: Dictionary;
  openPdf(bytes: Uint8Array): Promise<PdfDocLike>;
  /** OCR every page of a scanned PDF. Absent → scanned PDFs are rejected. */
  ocrPdf?(doc: PdfDocLike): Promise<Page[]>;
  /** OCR one image (JPEG/PNG/HEIC). Absent → images are rejected. */
  ocrImage?(bytes: Uint8Array, kind: 'jpeg' | 'png' | 'heic', page: number): Promise<Page>;
  onStatus?(status: 'reading' | 'ocr'): void;
};

async function pdfPages(bytes: Uint8Array, deps: ParseDeps): Promise<{ pages: Page[]; method: Method }> {
  const doc = await deps.openPdf(bytes);
  const { pages, chars } = await pdfTextPages(doc);
  if (!looksScanned(chars, doc.numPages)) return { pages, method: 'text' };
  if (!deps.ocrPdf) throw new UnsupportedFileError("This PDF is a scan, and scans can't be read here.");
  deps.onStatus?.('ocr');
  return { pages: await deps.ocrPdf(doc), method: 'ocr' };
}

export async function parseFile(bytes: Uint8Array, fileName: string, deps: ParseDeps): Promise<ExtractedReport> {
  deps.onStatus?.('reading');
  const kind = sniff(bytes);
  let pages: Page[] = [];
  let method: Method = 'text';

  if (kind === 'pdf') {
    ({ pages, method } = await pdfPages(bytes, deps));
  } else if (kind === 'zip') {
    const entries = expandZip(bytes);
    const texts = entries.filter((e) => e.kind === 'text' && !/\.(json|xml|html?)$/i.test(e.name));
    const pdfs = entries.filter((e) => e.kind === 'pdf');
    const images = entries.filter((e) => e.kind === 'jpeg' || e.kind === 'png' || e.kind === 'heic');
    if (texts.length) {
      // Health Gorilla export: numbered per-page text files. Page images duplicate them, so skip OCR.
      pages = texts.map((e, i) => textToPage(strFromU8(e.bytes), i + 1));
    } else if (pdfs.length) {
      for (const p of pdfs) {
        const r = await pdfPages(p.bytes, deps);
        const offset = pages.length;
        pages.push(...r.pages.map((pg) => ({ page: pg.page + offset, items: pg.items.map((it) => ({ ...it, page: pg.page + offset })) })));
        if (r.method === 'ocr') method = 'ocr';
      }
    } else if (images.length && deps.ocrImage) {
      deps.onStatus?.('ocr');
      method = 'ocr';
      for (const [i, img] of images.entries()) pages.push(await deps.ocrImage(img.bytes, img.kind as 'jpeg' | 'png' | 'heic', i + 1));
    } else {
      throw new UnsupportedFileError('This archive has no lab report pages we can read.');
    }
  } else if (kind === 'jpeg' || kind === 'png' || kind === 'heic') {
    if (!deps.ocrImage) throw new UnsupportedFileError("Photos can't be read here.");
    deps.onStatus?.('ocr');
    method = 'ocr';
    pages = [await deps.ocrImage(bytes, kind, 1)];
  } else if (kind === 'text') {
    pages = [textToPage(strFromU8(bytes), 1)];
  } else {
    throw new UnsupportedFileError("This file type isn't supported. Choose a PDF or a photo of your report.");
  }
  return extractReport(pages, { fileName, method, dictionary: deps.dictionary });
}
