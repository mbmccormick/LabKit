import type { DictionaryEntry, DictionaryFile, Vendor } from './types';

export type Dictionary = {
  entries: readonly DictionaryEntry[];
  byLoinc: ReadonlyMap<string, DictionaryEntry>;
  /** SPEC §6.2 rule 2: (vendor, panel, name) → (vendor, name) → (generic, name). */
  match(vendor: Vendor, name: string, panel?: string): AliasMatch;
  search(query: string, limit?: number): DictionaryEntry[];
};

export type AliasMatch =
  | { kind: 'exact'; entry: DictionaryEntry; via: 'panel' | 'vendor' | 'generic' }
  | { kind: 'ambiguous'; candidates: DictionaryEntry[] }
  | { kind: 'none' };

export function normalizeName(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*([,/])\s*/g, '$1')
    .trim();
}

function key(vendor: string, panel: string | undefined, name: string): string {
  return `${vendor}\u0000${panel === undefined ? '' : normalizeName(panel)}\u0000${normalizeName(name)}`;
}

export function loadDictionary(file: DictionaryFile | { entries: DictionaryEntry[] }): Dictionary {
  const entries = file.entries;
  const byLoinc = new Map<string, DictionaryEntry>();
  const aliasIndex = new Map<string, DictionaryEntry[]>();

  for (const e of entries) {
    if (byLoinc.has(e.loinc)) throw new Error(`duplicate LOINC in dictionary: ${e.loinc}`);
    byLoinc.set(e.loinc, e);
    for (const a of e.aliases) {
      const k = key(a.vendor, a.panel, a.name);
      const list = aliasIndex.get(k) ?? [];
      if (!list.includes(e)) list.push(e);
      aliasIndex.set(k, list);
    }
  }

  function lookup(k: string): DictionaryEntry[] {
    return aliasIndex.get(k) ?? [];
  }

  function match(vendor: Vendor, name: string, panel?: string): AliasMatch {
    const tiers: [string, 'panel' | 'vendor' | 'generic'][] = [];
    if (panel !== undefined) tiers.push([key(vendor, panel, name), 'panel']);
    tiers.push([key(vendor, undefined, name), 'vendor']);
    if (vendor !== 'generic') tiers.push([key('generic', undefined, name), 'generic']);
    for (const [k, via] of tiers) {
      const found = lookup(k);
      if (found.length === 1) return { kind: 'exact', entry: found[0]!, via };
      if (found.length > 1) return { kind: 'ambiguous', candidates: found };
    }
    return { kind: 'none' };
  }

  const haystacks = entries.map((e) => ({
    e,
    text: normalizeName(e.text),
    rest: [e.display, e.loinc, ...e.aliases.map((a) => a.name)].map(normalizeName).join(' | '),
  }));

  function search(query: string, limit = 20): DictionaryEntry[] {
    const q = normalizeName(query);
    if (!q) return [];
    const terms = q.split(' ');
    const scored: { e: DictionaryEntry; score: number }[] = [];
    for (const h of haystacks) {
      const all = `${h.text} | ${h.rest}`;
      if (!terms.every((t) => all.includes(t))) continue;
      let score = 0;
      if (h.text === q) score += 100;
      else if (h.text.startsWith(q)) score += 50;
      else if (h.text.includes(q)) score += 25;
      if (h.rest.includes(q)) score += 10;
      score -= h.text.length / 100; // prefer shorter labels on ties
      scored.push({ e: h.e, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.e);
  }

  return { entries, byLoinc, match, search };
}
