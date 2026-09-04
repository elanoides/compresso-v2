/**
 * Ligature authoring, text tokenization and lookup for layout / export.
 */

import type { CustomGlyph, CustomGlyphLibrary, GlyphMatrix, Ligature, LigatureLibrary } from '../types/fontTypes';
import {
  foldGlyphKey,
  getGlyph,
  glyphWidth,
  hasGlyph,
  isBlank,
  snapshotGlyph,
  sortCoords,
} from './glyphs';

export const MIN_LIGATURE_WIDTH = 8;
export const MAX_LIGATURE_WIDTH = 16;
export const DEFAULT_EMPTY_LIGATURE_WIDTH = 10;

/** First PUA slot reserved for exported ligature glyphs. */
export const LIGATURE_PUA_BASE = 0xe010;

const EMPTY: LigatureLibrary = {};

export function isLigatureTrigger(trigger: string, ligatures: LigatureLibrary = EMPTY): boolean {
  return trigger.length >= 2 && Boolean(ligatures) && trigger in ligatures;
}

export function ligatureTriggers(ligatures: LigatureLibrary): readonly string[] {
  return Object.keys(ligatures).sort((a, b) => b.length - a.length || a.localeCompare(b, 'ru'));
}

/** Fold user input to a 2–4 character All-Caps trigger, or null. */
export function foldLigatureTrigger(raw: string): string | null {
  const folded = [...raw.trim().toUpperCase()].map((ch) => foldGlyphKey(ch)).join('');
  if (folded.length < 2 || folded.length > 4) {
    return null;
  }
  return folded;
}

/** Normalize user input: 2–4 All-Caps characters that exist in the catalog. */
export function normalizeLigatureTrigger(raw: string, custom?: CustomGlyphLibrary | null): string | null {
  const folded = foldLigatureTrigger(raw);
  if (!folded) {
    return null;
  }
  for (const ch of folded) {
    if (!hasGlyph(ch, custom)) {
      return null;
    }
  }
  return folded;
}

export function clampLigatureWidth(width: number): number {
  return Math.max(MIN_LIGATURE_WIDTH, Math.min(MAX_LIGATURE_WIDTH, Math.round(width)));
}

export function stitchLigatureFromTrigger(
  trigger: string,
  custom?: CustomGlyphLibrary | null,
): CustomGlyph {
  const chars = [...trigger];
  let colOffset = 0;
  const merged: Array<[number, number]> = [];
  for (const ch of chars) {
    const snap = snapshotGlyph(ch, custom);
    for (const [col, row] of snap.coords) {
      merged.push([col + colOffset, row]);
    }
    colOffset += snap.width;
  }
  const width = clampLigatureWidth(colOffset);
  return {
    width,
    coords: sortCoords(merged.filter(([col]) => col < width)),
  };
}

export function emptyLigatureGlyph(width = DEFAULT_EMPTY_LIGATURE_WIDTH): CustomGlyph {
  return { width: clampLigatureWidth(width), coords: [] };
}

export function ligatureFromGlyph(trigger: string, glyph: CustomGlyph): Ligature {
  return {
    trigger,
    width: clampLigatureWidth(glyph.width),
    coords: sortCoords(glyph.coords),
  };
}

export function snapshotLigature(trigger: string, ligatures: LigatureLibrary): CustomGlyph {
  const entry = ligatures[trigger];
  if (!entry) {
    return emptyLigatureGlyph();
  }
  return { width: entry.width, coords: entry.coords };
}

export function ligatureWidth(trigger: string, ligatures: LigatureLibrary): number {
  const entry = ligatures[trigger];
  if (!entry) {
    return DEFAULT_EMPTY_LIGATURE_WIDTH;
  }
  return clampLigatureWidth(entry.width);
}

export function getLigatureCoords(
  trigger: string,
  colScale: number,
  rowScale: number,
  ligatures: LigatureLibrary,
): GlyphMatrix {
  const entry = ligatures[trigger];
  if (!entry || entry.coords.length === 0) {
    return [];
  }
  const bankKey = `\0lig:${trigger}`;
  return getGlyph(bankKey, colScale, rowScale, {
    [bankKey]: { active: 0, versions: [{ width: entry.width, coords: entry.coords }] },
  });
}

export function firstCharOfToken(token: string): string {
  return [...token][0] ?? token;
}

export function lastCharOfToken(token: string): string {
  return [...token].at(-1) ?? token;
}

/**
 * Longest-match tokenization: registered ligature triggers replace character runs.
 */
export function tokenizeWithLigatures(
  chars: readonly string[],
  ligatures: LigatureLibrary,
): string[] {
  if (!ligatures || Object.keys(ligatures).length === 0) {
    return [...chars];
  }
  const prepared = ligatureTriggers(ligatures).map((trigger) => ({
    trigger,
    parts: [...trigger],
  }));
  const out: string[] = [];
  let index = 0;
  while (index < chars.length) {
    let matched: string | null = null;
    let matchedLen = 0;
    for (const { trigger, parts } of prepared) {
      if (parts.every((ch, offset) => chars[index + offset] === ch)) {
        matched = trigger;
        matchedLen = parts.length;
        break;
      }
    }
    if (matched) {
      out.push(matched);
      index += matchedLen;
    } else {
      out.push(chars[index]!);
      index += 1;
    }
  }
  return out;
}

export function normalizeTextWithLigatures(
  text: string,
  custom?: CustomGlyphLibrary | null,
  ligatures: LigatureLibrary = EMPTY,
): string[] {
  const chars: string[] = [];
  for (const ch of text) {
    if (ch === ' ' || ch === '\t') {
      chars.push(' ');
      continue;
    }
    if (ch === '\n' || ch === '\r' || ch === '\v' || ch === '\f') {
      continue;
    }
    const folded = foldGlyphKey(ch);
    if (hasGlyph(folded, custom)) {
      chars.push(folded);
    } else {
      chars.push('');
    }
  }
  return tokenizeWithLigatures(chars, ligatures);
}

/** Stable PUA code point for an exported ligature glyph. */
export function ligaturePuaCodePoint(index: number): number {
  return LIGATURE_PUA_BASE + index;
}

export function ligaturePuaChar(index: number): string {
  return String.fromCodePoint(ligaturePuaCodePoint(index));
}

export function ligatureGlyphName(trigger: string): string {
  const safe = [...trigger]
    .map((ch) => {
      if (ch >= 'A' && ch <= 'Z') {
        return ch;
      }
      if (ch >= '0' && ch <= '9') {
        return ch;
      }
      return `u${ch.codePointAt(0)!.toString(16)}`;
    })
    .join('');
  return `liga_${safe}`;
}

export function normalizeLigatureLibrary(raw: unknown): LigatureLibrary {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, Ligature> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const trigger = foldLigatureTrigger(key);
    if (!trigger) {
      continue;
    }
    const parsed = parseLigatureEntry(trigger, value);
    if (parsed) {
      out[trigger] = parsed;
    }
  }
  return out;
}

function parseLigatureEntry(trigger: string, raw: unknown): Ligature | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const coordsRaw = Array.isArray(source.coords)
    ? source.coords
    : Array.isArray(source.matrix)
      ? source.matrix
      : null;
  if (!coordsRaw) {
    return null;
  }
  const coords: Array<[number, number]> = [];
  for (const entry of coordsRaw) {
    if (!Array.isArray(entry) || entry.length < 2) {
      continue;
    }
    const col = Number(entry[0]);
    const row = Number(entry[1]);
    if (!Number.isFinite(col) || !Number.isFinite(row)) {
      continue;
    }
    coords.push([Math.trunc(col), Math.trunc(row)]);
  }
  const widthRaw =
    typeof source.width === 'number' && Number.isFinite(source.width)
      ? source.width
      : typeof source.cols === 'number' && Number.isFinite(source.cols)
        ? source.cols
        : 0;
  let width = Math.trunc(widthRaw);
  if (width < MIN_LIGATURE_WIDTH) {
    let maxCol = 0;
    for (const [col] of coords) {
      if (col > maxCol) {
        maxCol = col;
      }
    }
    width = Math.max(MIN_LIGATURE_WIDTH, maxCol + 1);
  }
  return {
    trigger,
    width: clampLigatureWidth(width),
    coords: sortCoords(coords),
  };
}

/** Layout advance for one token (single glyph or ligature). */
export function tokenAdvance(
  token: string,
  colScale: number,
  custom?: CustomGlyphLibrary | null,
  ligatures: LigatureLibrary = EMPTY,
  versionIndex?: number,
): number {
  if (isBlank(token)) {
    return glyphWidth(' ', custom) * Math.max(1, colScale);
  }
  if (isLigatureTrigger(token, ligatures)) {
    return ligatureWidth(token, ligatures) * Math.max(1, colScale);
  }
  return glyphWidth(token, custom, versionIndex) * Math.max(1, colScale);
}

/** Module coordinates for one layout token. */
export function tokenCoords(
  token: string,
  colScale: number,
  rowScale: number,
  custom?: CustomGlyphLibrary | null,
  ligatures: LigatureLibrary = EMPTY,
  versionIndex?: number,
): GlyphMatrix {
  if (isLigatureTrigger(token, ligatures)) {
    return getLigatureCoords(token, colScale, rowScale, ligatures);
  }
  return getGlyph(token, colScale, rowScale, custom, versionIndex);
}
