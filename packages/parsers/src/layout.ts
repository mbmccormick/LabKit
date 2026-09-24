// Row/column reconstruction helpers (SPEC §12.3). Reading order from pdf.js or
// OCR is never trusted: everything is rebuilt from coordinates.
import type { Line, Page, TextItem } from './types';

const charWidth = (it: TextItem) => (it.str.length ? it.w / it.str.length : it.h * 0.5);

/** Split items that contain column gaps (runs of 2+ spaces) into separate items. */
export function splitWideItems(items: TextItem[]): TextItem[] {
  const out: TextItem[] = [];
  for (const it of items) {
    const cw = charWidth(it);
    const re = /\S+(?: \S+)*/g;
    let m: RegExpExecArray | null;
    let any = false;
    while ((m = re.exec(it.str))) {
      any = true;
      out.push({ ...it, str: m[0], x: it.x + m.index * cw, w: m[0].length * cw });
    }
    if (!any) continue;
  }
  return out;
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/** Group items into lines by y (tolerance ≈ 40% of the median line height). */
export function groupLines(pages: Page[]): Line[] {
  const lines: Line[] = [];
  for (const p of pages) {
    const items = splitWideItems(p.items).filter((i) => i.str.trim());
    if (!items.length) continue;
    const tol = 0.4 * (median(items.map((i) => i.h)) || 1);
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    let cur: { y: number; items: TextItem[] } | undefined;
    const raw: { y: number; items: TextItem[] }[] = [];
    for (const it of items) {
      if (cur && Math.abs(it.y - cur.y) <= tol) {
        cur.items.push(it);
        cur.y = (cur.y * (cur.items.length - 1) + it.y) / cur.items.length;
      } else {
        cur = { y: it.y, items: [it] };
        raw.push(cur);
      }
    }
    for (const r of raw) {
      const merged = mergeItems(r.items.sort((a, b) => a.x - b.x));
      lines.push({ page: p.page, y: r.y, h: median(merged.map((i) => i.h)) || 1, items: merged, text: merged.map((i) => i.str).join('  ') });
    }
  }
  return lines;
}

/** Join word-level items separated by ordinary word spacing into phrases. */
export function mergeItems(items: TextItem[]): TextItem[] {
  const out: TextItem[] = [];
  for (const it of items) {
    const prev = out[out.length - 1];
    if (prev) {
      const gap = it.x - (prev.x + prev.w);
      const cw = Math.max(charWidth(prev), charWidth(it));
      if (gap < 1.6 * cw) {
        const sep = gap > 0.15 * cw ? ' ' : '';
        prev.str += sep + it.str;
        prev.w = it.x + it.w - prev.x;
        prev.h = Math.max(prev.h, it.h);
        continue;
      }
    }
    out.push({ ...it });
  }
  return out;
}

/**
 * Plain-text pages (e.g. Health Gorilla exports) → items, using character
 * columns as x. Runs separated by 2+ spaces become separate items.
 */
export function textToPage(text: string, page: number): Page {
  const items: TextItem[] = [];
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((rawLine, y) => {
      const line = expandTabs(rawLine);
      const re = /\S+(?: \S+)*/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line))) items.push({ str: m[0], x: m.index, y, w: m[0].length, h: 1, page });
    });
  return { page, items };
}

function expandTabs(s: string): string {
  let out = '';
  for (const ch of s) {
    if (ch === '\t') out += ' '.repeat(8 - (out.length % 8));
    else out += ch;
  }
  return out;
}
