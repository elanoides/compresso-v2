/**
 * Slab Serif Engine — parametric serifs on anatomical grid terminals.
 *
 * Serifs are a render/export overlay: they never mutate the editable glyph
 * matrix. Terminals are detected on Cap-Height (row 4) and Baseline (row 23).
 */

import type { GlyphMatrix, GridCoord, SerifParams } from '../types/fontTypes';
import { BASELINE, BODY_TOP, ROWS_TOTAL, sortCoords } from './glyphs';

/** Anatomical anchor rows (match the 28-row All-Caps grid). */
export const SERIF_CAP_HEIGHT_ROW = BODY_TOP; // 4
export const SERIF_BASELINE_ROW = BASELINE; // 23

/** Minimum vertical stem run so closed bowls (О) do not grow false feet. */
const MIN_STEM_RUN = 3;

export interface SerifResult {
  coords: GlyphMatrix;
  width: number;
}

function occupancy(
  coords: GlyphMatrix,
  width: number,
): { grid: boolean[][]; maxCol: number } {
  let maxCol = Math.max(0, width - 1);
  for (const [col] of coords) {
    if (col > maxCol) {
      maxCol = col;
    }
  }
  const cols = maxCol + 1;
  const grid: boolean[][] = Array.from({ length: ROWS_TOTAL }, () =>
    Array.from({ length: cols }, () => false),
  );
  for (const [col, row] of coords) {
    if (row >= 0 && row < ROWS_TOTAL && col >= 0 && col < cols) {
      grid[row]![col] = true;
    }
  }
  return { grid, maxCol };
}

function stemRunLength(
  grid: boolean[][],
  col: number,
  startRow: number,
  direction: 1 | -1,
): number {
  let run = 0;
  let row = startRow;
  while (row >= 0 && row < ROWS_TOTAL && grid[row]?.[col]) {
    run += 1;
    row += direction;
  }
  return run;
}

/**
 * A vertical terminal: filled on the anchor row, empty just outside the letter,
 * and a real stem continuing inward (filters horizontal bars / bowl bottoms).
 */
function isVerticalTerminal(
  grid: boolean[][],
  col: number,
  row: number,
  side: 'cap' | 'base',
): boolean {
  if (!grid[row]?.[col]) {
    return false;
  }
  if (side === 'base') {
    const below = row + 1;
    if (below < ROWS_TOTAL && grid[below]?.[col]) {
      return false;
    }
    return stemRunLength(grid, col, row, -1) >= MIN_STEM_RUN;
  }
  const above = row - 1;
  if (above >= 0 && grid[above]?.[col]) {
    return false;
  }
  return stemRunLength(grid, col, row, 1) >= MIN_STEM_RUN;
}

function serifDirections(
  col: number,
  width: number,
  type: SerifParams['type'],
): readonly (-1 | 1)[] {
  if (type === 'bilateral') {
    return [-1, 1];
  }
  // Unilateral (flag): only the outward side relative to the glyph centre.
  const center = (width - 1) / 2;
  if (col < center - 0.25) {
    return [-1];
  }
  if (col > center + 0.25) {
    return [1];
  }
  // Centre stem (I, T): keep both flags so the stem stays balanced.
  return [-1, 1];
}

/**
 * Overlay slab serifs onto a glyph matrix. Expands width and shifts columns
 * when serifs would leave the left edge.
 */
export function applySlabSerifs(
  coords: GlyphMatrix,
  width: number,
  serif: SerifParams,
): SerifResult {
  if (!serif.enabled || coords.length === 0 || width <= 0) {
    return { coords, width: Math.max(width, 0) };
  }
  if (!serif.applyToCap && !serif.applyToBase) {
    return { coords, width };
  }

  const length = Math.min(2, Math.max(1, Math.round(serif.length)));
  const { grid, maxCol } = occupancy(coords, width);
  const glyphWidth = Math.max(width, maxCol + 1);

  const additions: GridCoord[] = [];

  const scanRow = (row: number, side: 'cap' | 'base') => {
    for (let col = 0; col < glyphWidth; col += 1) {
      if (!isVerticalTerminal(grid, col, row, side)) {
        continue;
      }
      for (const dir of serifDirections(col, glyphWidth, serif.type)) {
        for (let step = 1; step <= length; step += 1) {
          const nextCol = col + dir * step;
          // Allow out-of-range columns — width expansion handles them below.
          if (nextCol >= 0 && nextCol < glyphWidth && grid[row]?.[nextCol]) {
            // Stop at existing ink so we do not bridge into a neighbouring stem.
            break;
          }
          additions.push([nextCol, row]);
        }
      }
    }
  };

  if (serif.applyToCap) {
    scanRow(SERIF_CAP_HEIGHT_ROW, 'cap');
  }
  if (serif.applyToBase) {
    scanRow(SERIF_BASELINE_ROW, 'base');
  }

  if (additions.length === 0) {
    return { coords, width: glyphWidth };
  }

  let minCol = 0;
  let maxSerifCol = glyphWidth - 1;
  for (const [col] of coords) {
    if (col < minCol) minCol = col;
    if (col > maxSerifCol) maxSerifCol = col;
  }
  for (const [col] of additions) {
    if (col < minCol) minCol = col;
    if (col > maxSerifCol) maxSerifCol = col;
  }

  const shift = minCol < 0 ? -minCol : 0;
  const nextWidth = Math.max(glyphWidth + shift, maxSerifCol + shift + 1);

  const merged: GridCoord[] = [];
  for (const [col, row] of coords) {
    merged.push([col + shift, row]);
  }
  for (const [col, row] of additions) {
    merged.push([col + shift, row]);
  }

  return { coords: sortCoords(merged), width: nextWidth };
}
