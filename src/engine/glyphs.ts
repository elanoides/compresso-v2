/**
 * All-Caps glyph access layer.
 *
 * The grid is 28 rows tall:
 *   rows  0..3   accents (Ё, Й diacritics)
 *   rows  4..23  cap-height body (20 rows)
 *   row     23   baseline — every glyph in a line sits on it
 *   rows 24..27  descenders (Ц, Щ tails, Д legs)
 */

import {
  BASELINE,
  GLYPHS,
  GLYPH_CHARS,
  GLYPH_WIDTHS,
  ROWS_TOTAL,
  SPACE_WIDTH_COLS,
} from '../data/glyphsData';
import type {
  CustomGlyph,
  CustomGlyphBank,
  CustomGlyphLibrary,
  GlyphMatrix,
  GridCoord,
} from '../types/fontTypes';

export {
  ACCENT_BOTTOM,
  ACCENT_TOP,
  BASELINE,
  BODY_BOTTOM,
  BODY_TOP,
  CAP_HEIGHT,
  DESC_BOTTOM,
  DESC_TOP,
  GLYPHS,
  GLYPH_CHARS,
  GLYPH_WIDTHS,
  ROWS_TOTAL,
  SPACE_WIDTH_COLS,
} from '../data/glyphsData';

const EMPTY: GlyphMatrix = [];

export const MIN_GLYPH_WIDTH = 3;
export const MAX_GLYPH_WIDTH = 9;
/** v1 + ss01 + ss02. */
export const MAX_GLYPH_VARIANTS = 3;

const EMPTY_CUSTOM: CustomGlyphLibrary = {};

function cloneGlyph(glyph: CustomGlyph): CustomGlyph {
  return {
    width: glyph.width,
    coords: glyph.coords.map(([col, row]) => [col, row] as const),
  };
}

function overlayOf(
  ch: string,
  custom: CustomGlyphLibrary | null | undefined,
  versionIndex?: number,
): CustomGlyph | undefined {
  const bank = custom?.[ch];
  if (!bank || bank.versions.length === 0) {
    return undefined;
  }
  const requested = versionIndex === undefined ? bank.active : versionIndex;
  const index = Math.min(Math.max(0, requested), bank.versions.length - 1);
  return bank.versions[index];
}

/** Write a matrix into the active slot of a bank, creating the bank if needed. */
export function writeActiveGlyph(
  bank: CustomGlyphBank | undefined,
  glyph: CustomGlyph,
): CustomGlyphBank {
  const next = cloneGlyph(glyph);
  if (!bank || bank.versions.length === 0) {
    return { active: 0, versions: [next] };
  }
  const active = Math.min(Math.max(0, bank.active), bank.versions.length - 1);
  return {
    active,
    versions: bank.versions.map((version, index) => (index === active ? next : version)),
  };
}

/** Append a copy of v1 and switch to it (`v2`, `v3`, …). */
export function addGlyphVariant(bank: CustomGlyphBank): CustomGlyphBank {
  if (bank.versions.length >= MAX_GLYPH_VARIANTS) {
    return bank;
  }
  const source = bank.versions[0] ?? { width: MIN_GLYPH_WIDTH, coords: EMPTY };
  return {
    active: bank.versions.length,
    versions: [...bank.versions, cloneGlyph(source)],
  };
}

export function selectGlyphVariant(bank: CustomGlyphBank, index: number): CustomGlyphBank {
  if (index < 0 || index >= bank.versions.length) {
    return bank;
  }
  return { ...bank, active: index };
}

/** Snapshot factory/v1 into a bank, then grow it until `index` exists and is active. */
export function ensureGlyphVariant(
  ch: string,
  bank: CustomGlyphBank | undefined,
  index: number,
): CustomGlyphBank {
  const clamped = Math.min(Math.max(0, index), MAX_GLYPH_VARIANTS - 1);
  const versions = [...(bank?.versions ?? [snapshotGlyph(ch, {})])];
  if (versions.length === 0) {
    versions.push(snapshotGlyph(ch, {}));
  }
  const source = versions[0]!;
  while (versions.length <= clamped) {
    versions.push(cloneGlyph(source));
  }
  return { active: clamped, versions };
}

/** Drop v2+ (`index >= 1`). v1 cannot be removed. */
export function removeGlyphVariant(bank: CustomGlyphBank, index: number): CustomGlyphBank {
  if (index < 1 || index >= bank.versions.length || bank.versions.length <= 1) {
    return bank;
  }
  const versions = bank.versions.filter((_, slot) => slot !== index);
  let active = bank.active;
  if (active === index) {
    active = index - 1;
  } else if (active > index) {
    active -= 1;
  }
  return { active: Math.min(active, versions.length - 1), versions };
}

/** Fold a typed character onto the All-Caps glyph key used in the catalog. */
export function foldGlyphKey(ch: string): string {
  if (ch === 'ё' || ch === 'Ё') {
    return 'Ё';
  }
  if (/\p{L}/u.test(ch)) {
    return ch.toUpperCase();
  }
  return ch;
}

/** Space or an unsupported character — laid out as an advance with no ink. */
export function isBlank(ch: string): boolean {
  return ch === ' ' || ch === '';
}

export function hasGlyph(ch: string, custom?: CustomGlyphLibrary | null): boolean {
  if (isBlank(ch)) {
    return false;
  }
  return ch in GLYPHS || Boolean(overlayOf(ch, custom));
}

/**
 * Map an input character onto a glyph key: whitespace folds to a space,
 * line breaks are dropped, `ё` folds to `Ё`, everything else upper-cases.
 * Returns `null` for characters that should be skipped entirely.
 */
export function resolveGlyphKey(
  ch: string,
  custom?: CustomGlyphLibrary | null,
): string | null {
  if (ch === ' ' || ch === '\t') {
    return ' ';
  }
  if (ch === '\n' || ch === '\r' || ch === '\v' || ch === '\f') {
    return null;
  }
  const folded = foldGlyphKey(ch);
  return hasGlyph(folded, custom) ? folded : '';
}

/** All-Caps normalization: one entry per rendered character. */
export function normalizeText(
  text: string,
  custom?: CustomGlyphLibrary | null,
): string[] {
  const out: string[] = [];
  for (const ch of text) {
    const key = resolveGlyphKey(ch, custom);
    if (key !== null) {
      out.push(key);
    }
  }
  return out;
}

function widthFromCoords(coords: GlyphMatrix): number {
  if (coords.length === 0) {
    return SPACE_WIDTH_COLS;
  }
  let maxCol = 0;
  for (const [col] of coords) {
    if (col > maxCol) {
      maxCol = col;
    }
  }
  return maxCol + 1;
}

/** Advance width of a glyph in grid columns. */
export function glyphWidth(
  ch: string,
  custom?: CustomGlyphLibrary | null,
  versionIndex?: number,
): number {
  if (isBlank(ch)) {
    return SPACE_WIDTH_COLS;
  }
  const overlay = overlayOf(ch, custom, versionIndex);
  if (overlay) {
    return Math.max(MIN_GLYPH_WIDTH, Math.min(MAX_GLYPH_WIDTH, overlay.width));
  }
  const known = GLYPH_WIDTHS[ch];
  if (known !== undefined) {
    return Math.max(1, known);
  }
  return widthFromCoords(GLYPHS[ch] ?? EMPTY);
}

export function scaledWidth(
  ch: string,
  colScale: number,
  custom?: CustomGlyphLibrary | null,
  versionIndex?: number,
): number {
  return glyphWidth(ch, custom, versionIndex) * Math.max(1, colScale);
}

/**
 * Multiply module density: every cell becomes a `colScale × rowScale` block.
 * Rows are squashed back into the 28-row grid so the baseline stays put.
 */
function scaleGlyphDensity(
  coords: GlyphMatrix,
  colScale: number,
  rowScale: number,
): GlyphMatrix {
  const expanded = new Map<number, GridCoord>();
  for (const [col, row] of coords) {
    for (let dr = 0; dr < rowScale; dr += 1) {
      for (let dc = 0; dc < colScale; dc += 1) {
        const c = col * colScale + dc;
        const r = row * rowScale + dr;
        expanded.set(c * 4096 + r, [c, r]);
      }
    }
  }

  let list = [...expanded.values()];

  if (rowScale > 1) {
    const maxRow = ROWS_TOTAL * rowScale - 1;
    const squashed = new Map<number, GridCoord>();
    for (const [col, row] of list) {
      const r = Math.round((row * (ROWS_TOTAL - 1)) / maxRow);
      squashed.set(col * 4096 + r, [col, r]);
    }
    list = [...squashed.values()];
  }

  list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return list;
}

const densityCache = new Map<string, GlyphMatrix>();

function baseCoords(
  ch: string,
  custom?: CustomGlyphLibrary | null,
  versionIndex?: number,
): GlyphMatrix {
  const overlay = overlayOf(ch, custom, versionIndex);
  if (overlay) {
    return overlay.coords;
  }
  return GLYPHS[ch] ?? EMPTY;
}

/** Module coordinates for one character at the given matrix multipliers. */
export function getGlyph(
  ch: string,
  colScale: number,
  rowScale: number,
  custom?: CustomGlyphLibrary | null,
  versionIndex?: number,
): GlyphMatrix {
  const base = baseCoords(ch, custom, versionIndex);
  if (!base || base.length === 0) {
    return EMPTY;
  }
  if (colScale <= 1 && rowScale <= 1) {
    return base;
  }
  const overlay = overlayOf(ch, custom, versionIndex);
  const stamp = overlay
    ? `c${overlay.width}:${overlay.coords.length}:${overlay.coords.map(([c, r]) => `${c}.${r}`).join(',')}`
    : '';
  const key = `${ch}|${colScale}|${rowScale}|${stamp}`;
  const cached = densityCache.get(key);
  if (cached) {
    return cached;
  }
  const scaled = scaleGlyphDensity(base, colScale, rowScale);
  densityCache.set(key, scaled);
  return scaled;
}

/** Factory matrix, or empty for a user-created character. */
export function factoryGlyph(ch: string): GlyphMatrix {
  return GLYPHS[ch] ?? EMPTY;
}

export function factoryWidth(ch: string): number {
  if (ch in GLYPH_WIDTHS) {
    return GLYPH_WIDTHS[ch]!;
  }
  return widthFromCoords(GLYPHS[ch] ?? EMPTY);
}

export function isFactoryChar(ch: string): boolean {
  return ch in GLYPHS;
}

/** Snapshot used when the user starts painting a factory glyph. */
export function snapshotGlyph(
  ch: string,
  custom?: CustomGlyphLibrary | null,
  versionIndex?: number,
): CustomGlyph {
  const overlay = overlayOf(ch, custom, versionIndex);
  if (overlay) {
    return cloneGlyph(overlay);
  }
  const factory = GLYPHS[ch] ?? EMPTY;
  return {
    width: glyphWidth(ch, EMPTY_CUSTOM),
    coords: factory.map(([col, row]) => [col, row] as const),
  };
}

export function sortCoords(coords: GlyphMatrix): GlyphMatrix {
  const unique = new Map<number, GridCoord>();
  for (const [col, row] of coords) {
    if (col < 0 || row < 0 || row >= ROWS_TOTAL) {
      continue;
    }
    unique.set(col * 4096 + row, [col, row]);
  }
  const list = [...unique.values()];
  list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return list;
}

export function setGlyphCell(
  coords: GlyphMatrix,
  col: number,
  row: number,
  filled: boolean,
): GlyphMatrix {
  const next = coords.filter(([c, r]) => !(c === col && r === row));
  if (filled) {
    return sortCoords([...next, [col, row]]);
  }
  return sortCoords(next);
}

export function clipGlyphWidth(coords: GlyphMatrix, width: number): GlyphMatrix {
  return sortCoords(coords.filter(([col]) => col < width));
}

/** Factory alphabet plus any extra user-created characters. */
export function fontCharset(custom?: CustomGlyphLibrary | null): readonly string[] {
  if (!custom) {
    return GLYPH_CHARS;
  }
  const extra = Object.keys(custom).filter((ch) => !(ch in GLYPHS));
  extra.sort((a, b) => a.localeCompare(b, 'ru'));
  return extra.length > 0 ? [...GLYPH_CHARS, ...extra] : GLYPH_CHARS;
}

/** Characters offered in the glyph inspector, in alphabet order. */
export const INSPECTOR_CHARS: readonly string[] = GLYPH_CHARS;

/** Row index of the baseline — exported for guide drawing. */
export const BASELINE_ROW = BASELINE;
