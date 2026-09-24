// Lazy OCR with tesseract.js (SPEC §12.2). Browser only. All files are
// self-hosted under /vendor/ocr/ (no CDN); the worker is loaded from our origin.
import type { Page, TextItem } from './types';

export type OcrPaths = { workerPath: string; corePath: string; langPath: string };
export type OcrImage = HTMLCanvasElement | OffscreenCanvas | ImageBitmap | Blob;

export type Ocr = { recognize(image: OcrImage, page: number): Promise<Page>; terminate(): Promise<void> };

type Bbox = { x0: number; y0: number; x1: number; y1: number };
type Word = { text: string; bbox: Bbox };

export async function createOcr(paths: OcrPaths, onProgress?: (p: number) => void): Promise<Ocr> {
  const { createWorker, OEM } = await import('tesseract.js');
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    ...paths,
    workerBlobURL: false,
    gzip: true,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  return {
    async recognize(image, page) {
      const { data } = await worker.recognize(image as never, {}, { blocks: true });
      const items: TextItem[] = [];
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            for (const w of line.words as Word[]) {
              if (!w.text.trim()) continue;
              items.push({ str: w.text, x: w.bbox.x0, y: w.bbox.y1, w: w.bbox.x1 - w.bbox.x0, h: w.bbox.y1 - w.bbox.y0, page });
            }
          }
        }
      }
      return { page, items };
    },
    terminate: () => worker.terminate().then(() => undefined),
  };
}
