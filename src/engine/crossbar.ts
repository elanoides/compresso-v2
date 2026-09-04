/**
 * Detect and shift horizontal crossbars without touching vertical stems.
 *
 * Stems (column 0, column max, and any other full-height post) stay put.
 * Only interior modules of the primary bar move.
 */

import type { GlyphMatrix, GridCoord } from '../types/fontTypes';
import { BASELINE, BODY_TOP, ROWS_TOTAL } from './glyphs';

/** Letters whose primary crossbar can be moved from the inspector. */
export const CROSSBAR_LETTERS: readonly string[] = [
  'H',
  'A',
  'E',
  'F',
  'P',
  'B',
  'Н',
  'А',
  'Е',
  'Р',
  'В',
  'Ю',
  'Б',
  'Э',
  'П',
];

/** First row a bar is allowed to occupy (just below cap-height). */
export const CROSSBAR_MIN_ROW = BODY_TOP + 1;
/** Last row a bar is allowed to occupy (just above baseline). */
export const CROSSBAR_MAX_ROW = BASELINE - 1;

const STEM_MIN_ROWS = 10;
const BODY_SPAN = BASELINE - BODY_TOP + 1;
const OPTICAL_CENTER = (BODY_TOP + BASELINE) / 2;

export interface Crossbar {
  rows: readonly number[];
  innerCols: readonly number[];
  stemCols: readonly number[];
}

function cellKey(col: number, row: number): number {
  return col * 4096 + row;
}

function occupancy(coords: GlyphMatrix, width: number): boolean[][] {
  const grid: boolean[][] = Array.from({ length: ROWS_TOTAL }, () =>
    Array.from({ length: width }, () => false),
  );
  for (const [col, row] of coords) {
    if (row >= 0 && row < ROWS_TOTAL && col >= 0 && col < width) {
      grid[row]![col] = true;
    }
  }
  return grid;
}

function edgeStemColumns(width: number): readonly [number, number] {
  return [0, Math.max(0, width - 1)];
}

function tallStemColumns(grid: boolean[][], width: number): number[] {
  const stems: number[] = [];
  for (let col = 0; col < width; col += 1) {
    let count = 0;
    for (let row = BODY_TOP; row <= BASELINE; row += 1) {
      if (grid[row]?.[col]) {
        count += 1;
      }
    }
    if (count >= Math.min(STEM_MIN_ROWS, BODY_SPAN)) {
      stems.push(col);
    }
  }
  return stems;
}

/** Columns that never move with the bar: the two edges plus any full-height post. */
function protectedColumns(grid: boolean[][], width: number): Set<number> {
  const protectedCols = new Set<number>(edgeStemColumns(width));
  for (const col of tallStemColumns(grid, width)) {
    protectedCols.add(col);
  }
  return protectedCols;
}

function innerFilledCols(
  grid: boolean[][],
  row: number,
  width: number,
  protectedCols: ReadonlySet<number>,
): number[] {
  const inner: number[] = [];
  for (let col = 1; col < width - 1; col += 1) {
    if (protectedCols.has(col)) {
      continue;
    }
    if (grid[row]?.[col]) {
      inner.push(col);
    }
  }
  return inner;
}

function clustersOf(rows: readonly number[]): number[][] {
  if (rows.length === 0) {
    return [];
  }
  const groups: number[][] = [];
  let current: number[] = [rows[0]!];
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i]!;
    if (row === current[current.length - 1]! + 1) {
      current.push(row);
    } else {
      groups.push(current);
      current = [row];
    }
  }
  groups.push(current);
  return groups;
}

function clusterCenter(rows: readonly number[]): number {
  return (rows[0]! + rows[rows.length - 1]!) / 2;
}

function clampRow(row: number): number {
  return Math.min(CROSSBAR_MAX_ROW, Math.max(CROSSBAR_MIN_ROW, row));
}

function clampShift(minRow: number, maxRow: number, delta: number): number {
  let shift = delta;
  if (delta < 0 && minRow + shift < CROSSBAR_MIN_ROW) {
    shift = Math.min(0, CROSSBAR_MIN_ROW - minRow);
  }
  if (delta > 0 && maxRow + shift > CROSSBAR_MAX_ROW) {
    shift = Math.max(0, CROSSBAR_MAX_ROW - maxRow);
  }
  return shift;
}

/**
 * Locate the primary horizontal bar: interior run near the optical centre
 * (Н, Е, А). Fall back to the top bar (П). Inner columns never include stems.
 */
export function detectCrossbar(coords: GlyphMatrix, width: number): Crossbar | null {
  if (width < 3 || coords.length === 0) {
    return null;
  }
  const grid = occupancy(coords, width);
  const protectedCols = protectedColumns(grid, width);
  const barRows: number[] = [];
  for (let row = 0; row < ROWS_TOTAL; row += 1) {
    if (innerFilledCols(grid, row, width, protectedCols).length > 0) {
      barRows.push(row);
    }
  }
  const groups = clustersOf(barRows);
  if (groups.length === 0) {
    return null;
  }

  const interior = groups.filter((rows) => {
    const mid = clusterCenter(rows);
    return mid >= CROSSBAR_MIN_ROW && mid <= CROSSBAR_MAX_ROW;
  });
  const chosen =
    interior.length > 0
      ? interior.reduce((best, rows) =>
          Math.abs(clusterCenter(rows) - OPTICAL_CENTER) <
          Math.abs(clusterCenter(best) - OPTICAL_CENTER)
            ? rows
            : best,
        )
      : groups[0]!;

  const inner = new Set<number>();
  for (const row of chosen) {
    for (const col of innerFilledCols(grid, row, width, protectedCols)) {
      inner.add(col);
    }
  }
  if (inner.size === 0) {
    return null;
  }

  return {
    rows: chosen,
    innerCols: [...inner].sort((a, b) => a - b),
    stemCols: [...protectedCols].sort((a, b) => a - b),
  };
}

export function isCrossbarLetter(ch: string): boolean {
  return CROSSBAR_LETTERS.includes(ch);
}

/** Offset of the current bar relative to the factory bar, in rows. Down is positive. */
export function crossbarOffset(
  current: GlyphMatrix,
  factory: GlyphMatrix,
  width: number,
): number {
  const now = detectCrossbar(current, width);
  const origin = detectCrossbar(factory, width);
  if (!now || !origin) {
    return 0;
  }
  return now.rows[0]! - origin.rows[0]!;
}

function rebuildWithBar(
  current: GlyphMatrix,
  width: number,
  innerCols: readonly number[],
  rowsToClear: ReadonlySet<number>,
  targetRows: readonly number[],
): GlyphMatrix {
  const maxCol = width - 1;
  const inner = new Set(innerCols);
  const next = new Map<number, GridCoord>();

  for (const [col, row] of current) {
    if (col === 0 || col === maxCol) {
      next.set(cellKey(col, row), [col, row]);
      continue;
    }
    if (inner.has(col) && rowsToClear.has(row)) {
      continue;
    }
    next.set(cellKey(col, row), [col, row]);
  }

  for (const row of targetRows) {
    for (const col of innerCols) {
      if (col <= 0 || col >= maxCol) {
        continue;
      }
      next.set(cellKey(col, row), [col, row]);
    }
  }

  const list = [...next.values()];
  list.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return list;
}

/**
 * Move the inner cells of the primary crossbar by `delta` rows.
 * Columns 0 and max never change. The cluster is clamped to rows 5…22.
 */
export function shiftCrossbar(
  coords: GlyphMatrix,
  width: number,
  delta: number,
): GlyphMatrix {
  if (delta === 0) {
    return coords;
  }
  const bar = detectCrossbar(coords, width);
  if (!bar) {
    return coords;
  }
  const shift = clampShift(bar.rows[0]!, bar.rows[bar.rows.length - 1]!, delta);
  if (shift === 0) {
    return coords;
  }
  const targetRows = bar.rows.map((row) => clampRow(row + shift));
  const rowsToClear = new Set(bar.rows);
  for (const row of targetRows) {
    rowsToClear.add(row);
  }
  return rebuildWithBar(coords, width, bar.innerCols, rowsToClear, targetRows);
}

/**
 * Place the factory bar at `offset` relative to its factory row.
 * Stems from the live glyph are copied through unchanged.
 */
export function applyCrossbarOffset(
  current: GlyphMatrix,
  factory: GlyphMatrix,
  width: number,
  offset: number,
): GlyphMatrix {
  const origin = detectCrossbar(factory, width) ?? detectCrossbar(current, width);
  if (!origin) {
    return current;
  }
  const shift = clampShift(origin.rows[0]!, origin.rows[origin.rows.length - 1]!, offset);
  const live = detectCrossbar(current, width);
  const rowsToClear = new Set(origin.rows);
  if (live && clusterCenter(live.rows) >= CROSSBAR_MIN_ROW) {
    for (const row of live.rows) {
      rowsToClear.add(row);
    }
  }
  const targetRows =
    shift === 0
      ? origin.rows
      : origin.rows.map((row) => clampRow(row + shift));
  for (const row of targetRows) {
    rowsToClear.add(row);
  }
  return rebuildWithBar(current, width, origin.innerCols, rowsToClear, targetRows);
}
