// Pages → ParsedReport (SPEC §12).
import type { Dictionary, ParsedReport, ParsedRow } from '@labkit/core';
import { groupLines } from './layout';
import { evaluateRow, makeMatcher } from './rows';
import { extractPatient } from './stamps';
import { extractTable } from './table';
import type { Template } from './template';
import type { Method, Page } from './types';
import { generic, pickTemplate } from './vendors';

export type Draw = { collectedAt: string; timeFound: boolean; rows: ParsedRow[] };
export type ExtractedReport = ParsedReport & { draws: Draw[]; warnings: string[] };

export type ExtractOptions = { fileName: string; method: Method; dictionary: Dictionary; template?: Template };

export function extractReport(pages: Page[], opts: ExtractOptions): ExtractedReport {
  const lines = groupLines(pages);
  const fullText = lines.map((l) => l.text).join('\n');
  let template = opts.template ?? pickTemplate(fullText);
  const warnings: string[] = [];

  // Only read results from pages in this template's layout (see Template.pageFilter).
  const pageText = new Map<number, string>();
  for (const l of lines) pageText.set(l.page, `${pageText.get(l.page) ?? ''}\n${l.text}`);
  const keep = (t: Template) => (l: { page: number }) => !t.pageFilter || t.pageFilter(pageText.get(l.page) ?? '');
  let table = extractTable(lines.filter(keep(template)), template);
  if (!table.headerFound && template !== generic) {
    template = generic;
    table = extractTable(lines, generic);
  }
  const skipped = [...pageText.keys()].filter((p) => !keep(template)({ page: p })).length;
  if (skipped) warnings.push(`Skipped ${skipped} page${skipped === 1 ? '' : 's'} that repeat the same results in another layout.`);

  if (!table.headerFound) warnings.push("We couldn't find a results table in this file.");

  const match = makeMatcher(opts.dictionary);
  const ctx = { vendor: template.aliasVendor, method: opts.method, maxConfidence: template.maxConfidence, match };
  const fallback = table.stamps[0];

  const draws = new Map<string, Draw>();
  const unmatched: ParsedReport['unmatched'] = [];
  let undated = 0;
  for (const raw of table.rows) {
    const row = evaluateRow(raw, ctx);
    if (!row) continue;
    if (!row.entry) {
      unmatched.push({ text: row.raw.line, page: row.raw.page });
      continue;
    }
    const stamp = raw.collected ?? fallback;
    if (!stamp) {
      undated++;
      continue;
    }
    const d = draws.get(stamp.iso) ?? { collectedAt: stamp.iso, timeFound: stamp.timeFound, rows: [] };
    d.rows.push(row);
    draws.set(stamp.iso, d);
  }
  if (undated) warnings.push(`${undated} result${undated === 1 ? '' : 's'} had no collection date and were left out.`);

  // Duplicate LOINC codes within a draw: flag all copies; the user keeps one.
  for (const d of draws.values()) {
    const counts = new Map<string, number>();
    for (const r of d.rows) counts.set(r.entry!.loinc, (counts.get(r.entry!.loinc) ?? 0) + 1);
    for (const r of d.rows) {
      if ((counts.get(r.entry!.loinc) ?? 0) > 1 && !r.issues.includes('duplicate')) {
        r.issues.push('duplicate');
        r.confidence = 'low';
      }
    }
  }

  return {
    source: { vendor: template.id, fileName: opts.fileName, method: opts.method },
    patient: extractPatient(lines),
    draws: [...draws.values()].sort((a, b) => a.collectedAt.localeCompare(b.collectedAt)),
    unmatched,
    warnings,
  };
}
