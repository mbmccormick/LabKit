// Shared fixture harness (SPEC §15 Parsers): synthetic fixtures in CI, private
// ones locally. Reports field-level diffs as paths only, never values, so real
// patient data can't leak into logs.
import { readFileSync } from 'node:fs';
import { loadDictionary, type DictionaryFile } from '@labkit/core';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseFile, type ExtractedReport, type PdfDocLike } from '../src';

export const root = new URL('../../../', import.meta.url).pathname;
export const dictionary = loadDictionary(JSON.parse(readFileSync(`${root}dictionary/dictionary.json`, 'utf8')) as DictionaryFile);

// Same options as the browser (apps/web/src/lib/parse.ts): font data changes how
// pdf.js splits and measures text items, so tests must match what users get.
const PDFJS_DIR = `${root}apps/web/public/vendor/pdfjs/`;
export async function openPdf(bytes: Uint8Array): Promise<PdfDocLike> {
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    enableXfa: false,
    cMapUrl: `${PDFJS_DIR}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_DIR}standard_fonts/`,
    wasmUrl: `${PDFJS_DIR}wasm/`,
    verbosity: 0,
  });
  return (await task.promise) as unknown as PdfDocLike;
}

export const parse = (path: string) => parseFile(new Uint8Array(readFileSync(path)), path.split('/').pop()!, { dictionary, openPdf });

type ExpRow = { loinc: string; value: number | string; comparator?: string; ucum?: string; low?: number; high?: number; confidence: string; issues: string[] };
export type Expected = {
  vendor: string;
  patient: Record<string, unknown>;
  draws: { collected: { utc: string } | { local: string }; rows: ExpRow[] }[];
  unmatched: string[];
};

const localIso = (s: string) => {
  const [d, t] = s.split('T') as [string, string];
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const [h, mi] = t.split(':').map(Number) as [number, number];
  return new Date(y, m - 1, day, h, mi).toISOString().replace(/\.\d{3}Z$/, 'Z');
};

/** Compact actual form, comparable to Expected. */
export function compact(r: ExtractedReport) {
  return {
    vendor: r.source.vendor,
    patient: r.patient,
    draws: r.draws.map((d) => ({
      collectedAt: d.collectedAt,
      rows: d.rows.map((row) => {
        const v = row.value;
        const out: Record<string, unknown> = { loinc: row.entry!.loinc, value: v ? (v.kind === 'quantity' ? v.value : v.text.replace(/^1:/, '1:')) : undefined };
        if (v?.kind === 'quantity') {
          out.ucum = v.ucum;
          if (v.comparator) out.comparator = v.comparator;
        }
        if (row.range?.low !== undefined) out.low = row.range.low;
        if (row.range?.high !== undefined) out.high = row.range.high;
        out.confidence = row.confidence;
        out.issues = row.issues;
        return out;
      }),
    })),
    unmatched: r.unmatched.map((u) => u.text),
  };
}

export type Score = { diffs: string[]; expectedRows: number; mappedRows: number; correctRows: number };

/** Field-level diff. Messages contain JSON paths only. */
export function score(actual: ReturnType<typeof compact>, exp: Expected): Score {
  const diffs: string[] = [];
  if (actual.vendor !== exp.vendor) diffs.push('vendor');
  for (const k of new Set([...Object.keys(exp.patient), ...Object.keys(actual.patient)])) {
    if (JSON.stringify((actual.patient as Record<string, unknown>)[k]) !== JSON.stringify(exp.patient[k])) diffs.push(`patient.${k}`);
  }
  if (actual.draws.length !== exp.draws.length) diffs.push(`draws.length (${actual.draws.length} vs ${exp.draws.length})`);
  let expectedRows = 0;
  let mappedRows = 0;
  let correctRows = 0;
  exp.draws.forEach((ed, i) => {
    const ad = actual.draws[i];
    const want = 'utc' in ed.collected ? ed.collected.utc : localIso(ed.collected.local);
    if (ad?.collectedAt !== want) diffs.push(`draws[${i}].collectedAt`);
    const pool = [...(ad?.rows ?? [])];
    ed.rows.forEach((er, j) => {
      expectedRows++;
      const k = pool.findIndex((r) => r.loinc === er.loinc);
      if (k < 0) {
        diffs.push(`draws[${i}].rows[${j}] ${er.loinc} missing`);
        return;
      }
      mappedRows++;
      const ar = pool.splice(k, 1)[0]!;
      let ok = true;
      for (const f of ['value', 'comparator', 'ucum', 'low', 'high', 'confidence', 'issues'] as const) {
        const a = JSON.stringify(ar[f] ?? (f === 'issues' ? [] : undefined));
        const e = JSON.stringify((er as Record<string, unknown>)[f] ?? (f === 'issues' ? [] : undefined));
        if (a !== e) {
          diffs.push(`draws[${i}].rows[${j}] ${er.loinc}.${f}`);
          if (f !== 'confidence' && f !== 'issues') ok = false;
        }
      }
      if (ok) correctRows++;
    });
    for (const extra of pool) diffs.push(`draws[${i}] unexpected row ${String(extra.loinc)}`);
  });
  const un = actual.unmatched.map((t) => exp.unmatched.find((n) => t.includes(n)) ?? '?');
  if (un.includes('?') || un.length !== exp.unmatched.length) diffs.push(`unmatched (${actual.unmatched.length} vs ${exp.unmatched.length})`);
  return { diffs, expectedRows, mappedRows, correctRows };
}
