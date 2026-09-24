import type { Template } from '../template';
import { generic } from './generic';
import { labcorpPdf } from './labcorp-pdf';
import { questHealthGorilla } from './quest-healthgorilla';
import { questPdf } from './quest-pdf';

/** Priority order (SPEC §12.6). */
export const TEMPLATES: readonly Template[] = [questHealthGorilla, questPdf, labcorpPdf, generic];

export function pickTemplate(text: string): Template {
  let best = generic;
  let score = 0;
  for (const t of TEMPLATES) {
    const s = t.detect(text);
    if (s > score) {
      best = t;
      score = s;
    }
  }
  return best;
}

export { generic, labcorpPdf, questHealthGorilla, questPdf };
