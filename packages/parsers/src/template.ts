import type { ParsedReport, Vendor } from '@labkit/core';
import type { TableResult } from './table';
import type { Line, SourceVendor } from './types';

/**
 * Column roles. previous/previousDate/lab/ignore columns are NEVER read:
 * pulling a previous value into the current draw is the most dangerous parse
 * error (SPEC §12.3.6).
 */
export type Role = 'name' | 'result' | 'inRange' | 'outOfRange' | 'flag' | 'units' | 'range' | 'previous' | 'previousDate' | 'lab' | 'ignore';

export const VALUE_ROLES: readonly Role[] = ['result', 'inRange', 'outOfRange'];

export type Template = {
  id: SourceVendor;
  /** Which dictionary alias vendor this layout's test names follow. */
  aliasVendor: Vendor;
  /** Higher wins; 0 = not this vendor. */
  detect(text: string): number;
  /** Header cells, matched against whole merged items (case-insensitive). */
  header: { role: Role; re: RegExp }[];
  /** Printed collection times: Quest prints UTC (SPEC §12.3.5); others are local. */
  collectedTz: 'utc' | 'local';
  /** Lines to drop entirely: headers/footers, confidentiality notices, page numbers. */
  skip: RegExp[];
  maxConfidence: 'high' | 'medium';
  /**
   * Pages whose results belong to this layout. Function Health's PDF appends
   * Quest's own "Enhanced PDF Report" after the Health Gorilla pages; it repeats
   * the same results (date only, no time) and must not become a second draw.
   */
  pageFilter?: (pageText: string) => boolean;
  /**
   * Test names end with a performing-lab code ("Calcium, Urine 01") keyed to a
   * "Performing Labs" legend ("01: LITPP - Labcorp Itasca, ..."). Only codes the
   * report's own legend lists are stripped, so a name that really ends in a number is kept.
   */
  labCodes?: boolean;
  /**
   * Layouts the header-driven reader can't follow (Randox: names that straddle the
   * value row, reference bands stacked above and below it) bring their own row reconstruction.
   */
  extractTable?(lines: Line[]): TableResult;
  /** Patient fields, when the layout's header block isn't one extractPatient knows (e.g. UK day-first dates). */
  patient?(lines: Line[]): ParsedReport['patient'];
  /**
   * The same test printed in several panels of one report (Randox repeats Triglycerides, HDL, HbA1c… under
   * each health area). Copies with the same value collapse into one row; `preferRangeOver` names panels whose
   * copy is used only when no other panel printed the test.
   */
  dedupe?: { preferRangeOver?: RegExp };
};

export const COMMON_SKIP: RegExp[] = [
  /^page \d+( of \d+)?$/i,
  /^\d+ of \d+$/,
  /confidential/i,
  /printed (from|on|by)/i,
  /^(ordering|referring) (physician|provider)/i,
  /^accession/i,
  /^specimen( id)?:/i,
  /^report (status|date|printed)/i,
  /^(final|preliminary) report$/i,
  // Patient header block, repeated at the top of every page.
  /^(patient( name)?|name|dob|d\.o\.b\.?|date of birth|birth ?date|sex|gender|age|report status|client|physician|fasting)\s*:/i,
];
