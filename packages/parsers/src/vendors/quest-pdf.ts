import { COMMON_SKIP, type Template } from '../template';

// Quest Diagnostics native patient report PDF.
export const questPdf: Template = {
  id: 'quest',
  aliasVendor: 'quest',
  detect: (t) => (/quest\s+diagnostics/i.test(t) ? 5 : 0),
  header: [
    { role: 'name', re: /^(test name|test|analyte name)$/i },
    { role: 'inRange', re: /^in range$/i },
    { role: 'result', re: /^result$/i },
    { role: 'outOfRange', re: /^out (of )?range$/i },
    { role: 'range', re: /^reference range$/i },
    { role: 'previous', re: /^previous result$/i },
    { role: 'previousDate', re: /^(date|previous date)$/i },
    { role: 'lab', re: /^lab$/i },
  ],
  // ASSUMPTION carried from SPEC §12.3.5 (Quest prints UTC); confirm on real reports.
  collectedTz: 'utc',
  skip: [...COMMON_SKIP, /^quest diagnostics/i, /^performing (laboratory|site)/i],
  maxConfidence: 'high',
};
