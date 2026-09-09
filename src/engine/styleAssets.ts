/**
 * Per-style glyph and ligature libraries.
 *
 * Glyph matrix edits belong to one начертание. Legacy studio saves kept a
 * single shared library — `distributeToStyles` copies that blob onto every
 * style name so existing projects keep looking the same until the user edits.
 */

import type {
  CustomGlyph,
  CustomGlyphBank,
  CustomGlyphLibrary,
  Ligature,
  LigatureLibrary,
} from '../types/fontTypes';

export type StyleScopedGlyphs = Record<string, CustomGlyphLibrary>;
export type StyleScopedLigatures = Record<string, LigatureLibrary>;
export type ApplyScope = 'current' | 'all';

export function cloneCustomGlyph(glyph: CustomGlyph): CustomGlyph {
  return {
    width: glyph.width,
    coords: glyph.coords.map(([col, row]) => [col, row] as const),
  };
}

export function cloneCustomGlyphLibrary(library: CustomGlyphLibrary): CustomGlyphLibrary {
  const out: Record<string, CustomGlyphBank> = {};
  for (const [ch, bank] of Object.entries(library)) {
    out[ch] = {
      active: bank.active,
      versions: bank.versions.map(cloneCustomGlyph),
    };
  }
  return out;
}

export function cloneLigatureLibrary(library: LigatureLibrary): LigatureLibrary {
  const out: Record<string, Ligature> = {};
  for (const [trigger, entry] of Object.entries(library)) {
    out[trigger] = {
      trigger: entry.trigger,
      width: entry.width,
      coords: entry.coords.map(([col, row]) => [col, row] as const),
    };
  }
  return out;
}

export function distributeToStyles<T>(
  value: T,
  styleNames: readonly string[],
  clone: (value: T) => T,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const name of styleNames) {
    out[name] = clone(value);
  }
  return out;
}

export function renameStyleKey<T>(
  map: Readonly<Record<string, T>>,
  from: string,
  to: string,
): Record<string, T> {
  if (from === to || !(from in map)) {
    return { ...map };
  }
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(map)) {
    out[key === from ? to : key] = value;
  }
  return out;
}

export function deleteStyleKey<T>(
  map: Readonly<Record<string, T>>,
  name: string,
): Record<string, T> {
  if (!(name in map)) {
    return { ...map };
  }
  const out = { ...map };
  delete out[name];
  return out;
}

export function libraryForStyle<T extends object>(
  map: Readonly<Record<string, T>>,
  styleName: string,
  empty: T,
): T {
  return map[styleName] ?? empty;
}
