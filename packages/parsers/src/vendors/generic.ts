import { COMMON_SKIP, type Template } from '../template';

// Header-token column detection with no vendor assumptions. Everything is
// capped at medium confidence (SPEC §12.6.4).
export const generic: Template = {
  id: 'generic',
  aliasVendor: 'generic',
  detect: () => 1,
  header: [
    { role: 'name', re: /^(tests?|test name|analyte|component|biomarker|marker|description)$/i },
    { role: 'result', re: /^(results?|value|your (result|value)|current result( and flag)?|observed value)$/i },
    { role: 'inRange', re: /^in range$/i },
    { role: 'outOfRange', re: /^out of range$/i },
    { role: 'flag', re: /^(flag|abnormal|status)$/i },
    { role: 'units', re: /^(units?|uom)$/i },
    { role: 'range', re: /^(reference (range|interval)|ref(\.|erence)? ?range|normal range|range|standard range)$/i },
    { role: 'previous', re: /^(previous( result)?|prior( result)?|last result)$/i },
    { role: 'previousDate', re: /^(previous date|prior date|date)$/i },
    { role: 'lab', re: /^(lab|site|performing lab)$/i },
  ],
  collectedTz: 'local',
  skip: COMMON_SKIP,
  maxConfidence: 'medium',
};
