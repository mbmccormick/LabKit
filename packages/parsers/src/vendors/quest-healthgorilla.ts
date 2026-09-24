import { COMMON_SKIP, type Template } from '../template';

// Function Health "Lab Results of Record": Quest results exported by Health
// Gorilla as numbered per-page text files (SPEC §12.1, §12.6.1).
export const questHealthGorilla: Template = {
  id: 'quest-healthgorilla',
  aliasVendor: 'quest',
  detect: (t) => (/health\s*gorilla/i.test(t) ? 10 : 0),
  header: [
    { role: 'name', re: /^(test|test name)$/i },
    { role: 'inRange', re: /^in range$/i },
    { role: 'outOfRange', re: /^out of range$/i },
    { role: 'range', re: /^reference range$/i },
    { role: 'previous', re: /^previous result$/i },
    { role: 'previousDate', re: /^date$/i },
    { role: 'lab', re: /^lab$/i },
  ],
  collectedTz: 'utc',
  skip: [...COMMON_SKIP, /health\s*gorilla/i],
  maxConfidence: 'high',
  pageFilter: (t) => /health\s*gorilla/i.test(t),
};
