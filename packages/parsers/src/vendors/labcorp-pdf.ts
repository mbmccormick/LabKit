import { COMMON_SKIP, type Template } from '../template';

// Labcorp patient report PDF: test, current result and flag, previous result
// and date, units, reference interval (SPEC §12.3.3). Needs real fixtures.
export const labcorpPdf: Template = {
  id: 'labcorp',
  aliasVendor: 'labcorp',
  detect: (t) => (/lab\s*corp|laboratory corporation of america/i.test(t) ? 5 : 0),
  header: [
    { role: 'name', re: /^(tests?|test name)$/i },
    { role: 'result', re: /^(current result( and flag)?|result)$/i },
    { role: 'flag', re: /^flag$/i },
    { role: 'previous', re: /^previous result( and date)?$/i },
    { role: 'units', re: /^units$/i },
    { role: 'range', re: /^reference interval$/i },
    { role: 'lab', re: /^lab$/i },
  ],
  collectedTz: 'local',
  skip: [...COMMON_SKIP, /^labcorp/i, /^©/],
  maxConfidence: 'high',
  labCodes: true,
};
