import type { ParsedReport } from '@labkit/core';

/** A run of text with its position. y grows downward; units are PDF points, pixels or characters. */
export type TextItem = { str: string; x: number; y: number; w: number; h: number; page: number };

export type Page = { page: number; items: TextItem[] };

export type Method = ParsedReport['source']['method'];
export type SourceVendor = ParsedReport['source']['vendor'];

export type Line = { page: number; y: number; h: number; items: TextItem[]; text: string };
