import { loadDictionary, type Dictionary, type DictionaryFile } from '@labkit/core';

let pending: Promise<Dictionary> | undefined;

/** Served as a static asset so it stays out of the initial JS bundle. */
export function getDictionary(): Promise<Dictionary> {
  pending ??= fetch('/dictionary.json')
    .then((r) => {
      if (!r.ok) throw new Error(`dictionary ${r.status}`);
      return r.json() as Promise<DictionaryFile>;
    })
    .then(loadDictionary)
    .catch((e: unknown) => {
      pending = undefined;
      throw e;
    });
  return pending;
}
