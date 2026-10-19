import { COMMON_SKIP, type Template } from '../template';

// Header-token column detection with no vendor assumptions. Everything is
// capped at medium confidence (SPEC §12.6.4).
export const generic: Template = {
  id: 'generic',
  aliasVendor: 'generic',
  detect: () => 1,
  header: [
    { role: 'name', re: /^(tests?|test name|test description|lab test|analyte|component|biomarker|marker|parameter|description)$/i },
    { role: 'result', re: /^(results?|value|result value|test result|your (result|value)|current result( and flag)?|observed value|measured value)$/i },
    { role: 'inRange', re: /^in range$/i },
    { role: 'outOfRange', re: /^out of range$/i },
    { role: 'flag', re: /^(flags?|abnormal|status)$/i },
    { role: 'units', re: /^(units?|uom|units of measure)$/i },
    {
      role: 'range',
      re: /^(reference (range|interval|values?)|ref(\.|erence)? ?(range|interval)|normal (range|values?)|range|standard range|expected (range|values?)|lab (reference )?range)$/i,
    },
    { role: 'previous', re: /^(previous( result)?|prior( result)?|last result)$/i },
    { role: 'previousDate', re: /^(previous date|prior date|date)$/i },
    { role: 'lab', re: /^(lab|site|performing lab)$/i },
    // Direct-to-consumer reports print their own "optimal" target next to the lab's range. Never a reference
    // range (SPEC §11.6): it gets its own column so its text can't spill into the range column.
    { role: 'ignore', re: /^((optimal|target|goal|ideal|healthy|functional|longevity)( range| zone)?|your (target|goal|optimal range))$/i },
  ],
  collectedTz: 'local',
  skip: COMMON_SKIP,
  maxConfidence: 'medium',
};
