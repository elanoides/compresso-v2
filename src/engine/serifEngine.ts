/**
 * Modular serif engine — slab serifs made of grid cells.
 *
 * A serif is never a free-form contour: it is one or two extra cells lit next
 * to a stem terminal, drawn later with the very same module as every other
 * cell of the glyph. Terminals are looked up on Cap-Height (row 4) and
 * Baseline (row 23). The editable glyph matrix is never mutated — the overlay
 * lives only in the render and export pipelines.
 */

import type { GlyphMatrix, GridCoord, SerifParams } from '../types/fontTypes';
import { SERIF_MAX_WIDTH } from '../types/fontTypes';
import { BASELINE, BODY_TOP, ROWS_TOTAL, sortCoords } from './glyphs';

/** Anatomical anchor rows (match the 28-row All-Caps grid). */
export const SERIF_CAP_HEIGHT_ROW = BODY_TOP; // 4
export const SERIF_BASELINE_ROW = BASELINE; // 23

/**
 * Minimum vertical stem run at the anchor row. Keeps bowls and arcs (О, С),
 * and short tails like the comma, from growing false feet.
 */
const MIN_STEM_RUN = 4;

/** Widest ink run that still counts as a stem; above it the row is a bar (Т, Е). */
const MAX_STEM_COLS = 2;

export interface SerifResult {
  coords: GlyphMatrix;
  width: number;
  /** Columns the base matrix moved right to make room for left-edge serifs. */
  shift: number;
}

interface Occupancy {
  grid: boolean[][];
  cols: number;
}

function occupancy(coords: GlyphMatrix, width: number): Occupancy {
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
  return { grid, cols };
}

/**
 * Empty cells reachable from outside the glyph, found by a 4-way flood fill
 * that starts on a one-cell frame around the matrix. Whatever stays unvisited
 * is a closed counter (the ring of «О», the bowls of «Ф», «Ю») and must never
 * host a serif.
 */
function exteriorMask(grid: boolean[][], cols: number): boolean[][] {
  const outside: boolean[][] = Array.from({ length: ROWS_TOTAL }, () =>
    Array.from({ length: cols }, () => false),
  );
  const queue: GridCoord[] = [];

  const push = (col: number, row: number) => {
    if (col < 0 || col >= cols || row < 0 || row >= ROWS_TOTAL) {
      return;
    }
    if (outside[row]![col] || grid[row]![col]) {
      return;
    }
    outside[row]![col] = true;
    queue.push([col, row]);
  };

  for (let col = 0; col < cols; col += 1) {
    push(col, 0);
    push(col, ROWS_TOTAL - 1);
  }
  for (let row = 0; row < ROWS_TOTAL; row += 1) {
    push(0, row);
    push(cols - 1, row);
  }

  while (queue.length > 0) {
    const [col, row] = queue.pop()!;
    push(col - 1, row);
    push(col + 1, row);
    push(col, row - 1);
    push(col, row + 1);
  }

  return outside;
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

/** Contiguous ink width across `row` around `col`. */
function barRunLength(grid: boolean[][], col: number, row: number, cols: number): number {
  let run = 1;
  for (let c = col - 1; c >= 0 && grid[row]![c]; c -= 1) {
    run += 1;
  }
  for (let c = col + 1; c < cols && grid[row]![c]; c += 1) {
    run += 1;
  }
  return run;
}

/**
 * A free vertical terminal: filled on the anchor row, open just outside the
 * letter, with a real stem continuing inward. Filters horizontal bars (the top
 * of «Т», «Е») and the bottoms of closed bowls, which are not terminals.
 */
function isVerticalTerminal(
  grid: boolean[][],
  col: number,
  row: number,
  cols: number,
  scale: number,
  side: 'cap' | 'base',
): boolean {
  if (!grid[row]?.[col]) {
    return false;
  }
  if (barRunLength(grid, col, row, cols) > MAX_STEM_COLS * scale) {
    return false;
  }
  const inward = side === 'base' ? -1 : 1;
  const outward = row - inward;
  if (outward >= 0 && outward < ROWS_TOTAL && grid[outward]?.[col]) {
    return false;
  }
  return stemRunLength(grid, col, row, inward) >= MIN_STEM_RUN;
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
 * Overlay modular serifs onto a glyph matrix.
 *
 * `colScale` is the matrix density multiplier: one design module is that many
 * grid cells wide, so a serif of width 1 always reaches exactly one module.
 * Cells that fall past the left or right edge widen the matrix (and shift the
 * letter right when needed) so the glyph keeps its own proportions instead of
 * being squeezed.
 */
export function applySlabSerifs(
  coords: GlyphMatrix,
  width: number,
  serif: SerifParams,
  colScale = 1,
): SerifResult {
  const scale = Math.max(1, Math.round(colScale));
  const modules = Math.min(SERIF_MAX_WIDTH, Math.max(0, Math.round(serif?.width ?? 0)));
  const reach = modules * scale;
  if (reach === 0 || coords.length === 0 || width <= 0) {
    return { coords, width: Math.max(width, 0), shift: 0 };
  }
  if (!serif.applyToCap && !serif.applyToBase) {
    return { coords, width, shift: 0 };
  }

  const { grid, cols } = occupancy(coords, width);
  const outside = exteriorMask(grid, cols);
  const glyphWidth = Math.max(width, cols);

  const additions: GridCoord[] = [];

  const scanRow = (row: number, side: 'cap' | 'base') => {
    for (let col = 0; col < glyphWidth; col += 1) {
      if (!isVerticalTerminal(grid, col, row, cols, scale, side)) {
        continue;
      }
      for (const dir of serifDirections(col, glyphWidth, serif.type)) {
        for (let step = 1; step <= reach; step += 1) {
          const nextCol = col + dir * step;
          const insideMatrix = nextCol >= 0 && nextCol < cols;
          if (insideMatrix) {
            // Stop at existing ink so serifs never bridge two stems.
            if (grid[row]![nextCol]) {
              break;
            }
            // Never light a cell trapped in a closed counter (О, Ф, Ю).
            if (!outside[row]![nextCol]) {
              break;
            }
          }
          // Columns past the edge are legal: the matrix grows below.
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
    return { coords, width: glyphWidth, shift: 0 };
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

  return { coords: sortCoords(merged), width: nextWidth, shift };
}
