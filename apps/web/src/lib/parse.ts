// Browser wiring for @labkit/parsers: pdf.js (legacy build, self-hosted worker)
// and tesseract.js OCR, both lazy-loaded so they stay out of the initial bundle.
import type { Dictionary } from '@labkit/core';
import { parseFile, type ExtractedReport, type Page, type PdfDocLike } from '@labkit/parsers';

export type FileStatus = { phase: 'reading' } | { phase: 'ocr'; progress: number } | { phase: 'done'; report: ExtractedReport } | { phase: 'error'; message: string };

const VENDOR = '/vendor';
const MAX_OCR_SIDE = 2400;

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
type RenderablePage = {
  getViewport(o: { scale: number }): { width: number; height: number };
  render(o: { canvas: HTMLCanvasElement; canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> };
};

let pdfjsPromise: Promise<PdfJs> | undefined;
function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
    m.GlobalWorkerOptions.workerSrc = `${VENDOR}/pdfjs/pdf.worker.min.mjs`;
    return m;
  });
  return pdfjsPromise;
}

async function openPdf(bytes: Uint8Array): Promise<PdfDocLike> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: bytes,
    enableXfa: false,
    cMapUrl: `${VENDOR}/pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${VENDOR}/pdfjs/standard_fonts/`,
    wasmUrl: `${VENDOR}/pdfjs/wasm/`,
  });
  return (await task.promise) as unknown as PdfDocLike;
}

type Ocr = Awaited<ReturnType<typeof import('@labkit/parsers/ocr').createOcr>>;

function canvasFor(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(w);
  canvas.height = Math.round(h);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

async function imageToCanvas(bytes: Uint8Array, kind: 'jpeg' | 'png' | 'heic'): Promise<HTMLCanvasElement> {
  const type = kind === 'heic' ? 'image/heic' : `image/${kind}`;
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode().catch(() => {
      throw new Error(kind === 'heic' ? "This browser can't open HEIC photos. Open LabKit in Safari, or upload a JPEG or PDF." : "This image couldn't be opened.");
    });
    const scale = Math.min(1, MAX_OCR_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const { canvas, ctx } = canvasFor(img.naturalWidth * scale, img.naturalHeight * scale);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Parse one file entirely in the browser. Nothing is uploaded. */
export async function parseInBrowser(file: File, dictionary: Dictionary, onStatus: (s: FileStatus) => void): Promise<ExtractedReport> {
  let ocr: Ocr | undefined;
  let pagesDone = 0;
  let pagesTotal = 1;
  const getOcr = async () => {
    if (!ocr) {
      const { createOcr } = await import('@labkit/parsers/ocr');
      ocr = await createOcr({ workerPath: `${VENDOR}/ocr/worker.min.js`, corePath: `${VENDOR}/ocr/core`, langPath: `${VENDOR}/ocr/lang` }, (p) =>
        onStatus({ phase: 'ocr', progress: (pagesDone + p) / pagesTotal }),
      );
    }
    return ocr;
  };

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return await parseFile(bytes, file.name, {
      dictionary,
      openPdf,
      onStatus: (s) => onStatus(s === 'ocr' ? { phase: 'ocr', progress: 0 } : { phase: 'reading' }),
      async ocrPdf(doc) {
        const engine = await getOcr();
        pagesTotal = doc.numPages;
        const pages: Page[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = (await doc.getPage(n)) as unknown as RenderablePage;
          const base = page.getViewport({ scale: 1 });
          const scale = Math.min(3, MAX_OCR_SIDE / Math.max(base.width, base.height));
          const viewport = page.getViewport({ scale });
          const { canvas, ctx } = canvasFor(viewport.width, viewport.height);
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          pages.push(await engine.recognize(canvas, n));
          canvas.width = canvas.height = 0;
          pagesDone = n;
        }
        return pages;
      },
      async ocrImage(imgBytes, kind, n) {
        const engine = await getOcr();
        const canvas = await imageToCanvas(imgBytes, kind);
        const page = await engine.recognize(canvas, n);
        canvas.width = canvas.height = 0;
        pagesDone++;
        return page;
      },
    });
  } finally {
    await ocr?.terminate();
  }
}
