import { z } from 'zod';
import { CATEGORIES, VENDORS } from './types';

const LOINC_RE = /^\d{1,7}-\d$/;

export const dictionaryEntrySchema = z.strictObject({
  loinc: z.string().regex(LOINC_RE),
  display: z.string().min(1),
  text: z.string().min(1),
  category: z.enum(CATEGORIES),
  valueType: z.enum(['quantity', 'qualitative', 'titer']),
  ucum: z.string().min(1).nullable(),
  unitAliases: z.record(z.string(), z.string()).optional(),
  unitConversions: z
    .array(z.strictObject({ from: z.string().min(1), factor: z.number().positive(), note: z.string().optional() }))
    .optional(),
  answers: z.array(z.string().min(1)).min(1).optional(),
  plausible: z.strictObject({ min: z.number(), max: z.number() }).optional(),
  aliases: z.array(z.strictObject({ vendor: z.enum(VENDORS), name: z.string().min(1), panel: z.string().min(1).optional() })).min(1),
  excludeFromSigning: z.boolean().optional(),
});

export const dictionaryFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  note: z.string().optional(),
  entries: z.array(dictionaryEntrySchema),
});
