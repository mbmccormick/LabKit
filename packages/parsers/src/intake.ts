// Magic-byte sniffing and ZIP expansion (SPEC §12.1). Extensions are ignored:
// Function Health's "results of record" .pdf downloads are really ZIPs.
import { unzipSync } from 'fflate';

export type Kind = 'pdf' | 'zip' | 'jpeg' | 'png' | 'heic' | 'text' | 'unknown';

export function sniff(b: Uint8Array): Kind {
  const at = (i: number, ...bytes: number[]) => bytes.every((x, k) => b[i + k] === x);
  if (at(0, 0x25, 0x50, 0x44, 0x46)) return 'pdf'; // %PDF
  if (at(0, 0x50, 0x4b, 0x03, 0x04)) return 'zip'; // PK\x03\x04
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  // ISO-BMFF "ftyp" box with a HEIF brand
  if (at(4, 0x66, 0x74, 0x79, 0x70)) {
    const brand = String.fromCharCode(...b.subarray(8, 12));
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)$/.test(brand)) return 'heic';
  }
  const head = b.subarray(0, Math.min(b.length, 512));
  if (head.length && head.every((x) => x === 9 || x === 10 || x === 13 || (x >= 32 && x !== 127))) return 'text';
  return 'unknown';
}

export type ZipEntry = { name: string; kind: Kind; bytes: Uint8Array };

const MAX_ENTRIES = 500;
const MAX_TOTAL = 200 * 1024 * 1024;

/** Expands a ZIP, dropping directories and macOS metadata, in natural (page-number) order. */
export function expandZip(bytes: Uint8Array): ZipEntry[] {
  const files = unzipSync(bytes, {
    filter: (f) => !f.name.endsWith('/') && !/(^|\/)(__MACOSX|\.DS_Store)/.test(f.name) && f.originalSize < MAX_TOTAL,
  });
  const names = Object.keys(files);
  if (names.length > MAX_ENTRIES) throw new Error('This archive has too many files.');
  let total = 0;
  const out: ZipEntry[] = [];
  for (const name of names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const data = files[name]!;
    total += data.length;
    if (total > MAX_TOTAL) throw new Error('This archive is too large.');
    out.push({ name, kind: sniff(data), bytes: data });
  }
  return out;
}
