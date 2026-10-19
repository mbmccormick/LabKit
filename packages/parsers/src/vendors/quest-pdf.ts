import { COMMON_SKIP, type Template } from '../template';

// Quest Diagnostics native patient report PDF, also what resellers such as
// Walk-In Lab hand out: "Patient / Specimen / Client Information" header,
// "Collected: 09/29/2020 / 11:00 EDT", then Test Name | In Range | Out Of Range |
// Reference Range | Lab.
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
  // Quest's own reports print the site's US zone on the stamp, which always wins
  // (stamps.ts). Unzoned times keep SPEC §12.3.5's assumption that Quest prints UTC.
  collectedTz: 'utc',
  skip: [...COMMON_SKIP, /^quest diagnostics/i, /^performing (laboratory|site)/i],
  maxConfidence: 'high',
};
