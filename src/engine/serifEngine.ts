/**
 * Modular serif engine — slab serifs made of the current module.
 *
 * A serif is never a free-form contour. Either one plain module is lit on each
 * side of a stem terminal, or one module is stretched sideways into a bar over
 * the same cells. Terminals are looked up on Cap-Height (row 4) and Baseline
 * (row 23). The editable glyph matrix is never mutated — the overlay lives
 * only in the render and export pipelines.
 */

import type {
  GlyphMatrix,
  GridCoord,
  PlacedModule,
  SerifSettings,
  StyleParams,
} from '../types/fontTypes';
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

/** Serifs push neighbours apart, so tracking never drops below one module. */
const MIN_SERIF_TRACKING = 1;

/**
 * Round and oval glyphs carry no serifs at all: their apex and foot are arcs,
 * and a lit neighbour cell there turns the bowl into a horned shape.
 * Glyph names in `uniXXXX` form resolve to the same entries.
 *
 * «Ю» is deliberately absent: its left side is a straight full-height stem
 * that takes serifs, while the ring is already protected by the arc and
 * closed-counter rules below.
 */
export const SERIF_BLACKLIST: ReadonlySet<string> = new Set([
  'O',
  'Q',
  'C',
  'S',
  'G',
  'О', // uni041E
  'С', // uni0421
  'Э', // uni042D
]);

/** `uniXXXX` glyph name to its character, or the input when it is not a name. */
function charOfGlyphName(name: string): string {
  const match = /^uni([0-9A-Fa-f]{4,6})$/.exec(name);
  return match ? String.fromCodePoint(Number.parseInt(match[1]!, 16)) : name;
}

/**
 * True when the token must stay serif-free. A ligature keeps its serifs as
 * long as at least one of its characters is a straight-stemmed letter.
 */
export function isSerifBlacklisted(token: string): boolean {
  const key = charOfGlyphName(token);
  if (SERIF_BLACKLIST.has(key)) {
    return true;
  }
  const chars = [...key];
  return chars.length > 1 && chars.every((ch) => SERIF_BLACKLIST.has(ch));
}

/** Whether this style generates serifs at all. */
export function serifsActive(serif: SerifSettings | undefined): boolean {
  return serif?.enabled === true;
}

/**
 * Tracking used by layout and export. Serif cells reach into the sidebearings,
 * so an active serif engine keeps at least one module of letter spacing and
 * neighbouring letters cannot touch.
 */
export function effectiveLetterSpacing(p: StyleParams): number {
  return serifsActive(p.serif)
    ? Math.max(p.letterSpacing, MIN_SERIF_TRACKING)
    : p.letterSpacing;
}

export interface SerifResult {
  /** Glyph matrix plus, in `two-modules` mode, the lit serif cells. */
  coords: GlyphMatrix;
  /** Stretched serif bars, one per terminal, in `single-stretched` mode. */
  bars: PlacedModule[];
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
 * A free vertical terminal, and nothing else:
 *   – the anchor cell is ink;
 *   – the cell just inward (above a foot, below an apex) is ink too, and the
 *     straight run continues for at least `MIN_STEM_RUN` cells, so arcs and
 *     short tails («О», «С», «З», «Э», the comma) never qualify;
 *   – the cell just outward is empty or past the grid, so a stem that keeps
 *     going (the tails of «Ц», «Щ», «Д») is not a terminal;
 *   – the ink run across the anchor row is no wider than a stem, which rules
 *     out horizontal bars: both side neighbours lit means a crossbar («Т»,
 *     «Е», «Ш»), never a terminal.
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

/**
 * Overlay modular serifs onto the matrix of `token`.
 *
 * Round glyphs from `SERIF_BLACKLIST` come back untouched. Every serif sits on
 * the very row of its terminal and reaches one design module to each side,
 * which is `colScale` grid cells. In `two-modules` mode those cells are lit as
 * plain modules; in `single-stretched` mode they stay empty and the terminal
 * gets one module stretched across them. Either way the reach is the same, so
 * cells past the left or right edge widen the matrix (and shift the letter
 * right when needed) and the glyph keeps its proportions instead of being
 * squeezed.
 */
export function applySlabSerifs(
  token: string,
  coords: GlyphMatrix,
  width: number,
  serif: SerifSettings,
  colScale = 1,
): SerifResult {
  const reach = Math.max(1, Math.round(colScale));
  const empty: SerifResult = { coords, bars: [], width: Math.max(width, 0), shift: 0 };
  if (!serifsActive(serif) || coords.length === 0 || width <= 0) {
    return empty;
  }
  if (isSerifBlacklisted(token)) {
    return empty;
  }

  const { grid, cols } = occupancy(coords, width);
  const outside = exteriorMask(grid, cols);
  const glyphWidth = Math.max(width, cols);

  /** How far the serif may reach from `col` before it hits ink or a counter. */
  const freeRun = (col: number, row: number, dir: -1 | 1): number => {
    let run = 0;
    for (let step = 1; step <= reach; step += 1) {
      const next = col + dir * step;
      if (next >= 0 && next < cols && (grid[row]![next] || !outside[row]![next])) {
        break;
      }
      run += 1;
    }
    return run;
  };

  const cells: GridCoord[] = [];
  const bars: PlacedModule[] = [];

  const scanRow = (row: number, side: 'cap' | 'base') => {
    for (let col = 0; col < glyphWidth; col += 1) {
      if (!isVerticalTerminal(grid, col, row, cols, reach, side)) {
        continue;
      }
      const left = freeRun(col, row, -1);
      const right = freeRun(col, row, 1);
      if (left === 0 && right === 0) {
        continue;
      }
      if (serif.mode === 'single-stretched') {
        bars.push({ col, row, char: token, serif: { left, right } });
      }
      for (let step = 1; step <= left; step += 1) {
        cells.push([col - step, row]);
      }
      for (let step = 1; step <= right; step += 1) {
        cells.push([col + step, row]);
      }
    }
  };

  scanRow(SERIF_CAP_HEIGHT_ROW, 'cap');
  scanRow(SERIF_BASELINE_ROW, 'base');

  if (cells.length === 0) {
    return { coords, bars: [], width: glyphWidth, shift: 0 };
  }

  let minCol = 0;
  let maxCol = glyphWidth - 1;
  for (const [col] of [...coords, ...cells]) {
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
  }

  const shift = minCol < 0 ? -minCol : 0;
  const nextWidth = Math.max(glyphWidth + shift, maxCol + shift + 1);

  // A bar is centred on its terminal and fully covers that module, so the
  // stem cell is handed over to the bar instead of being drawn twice.
  const barCells = new Set(bars.map((bar) => `${bar.col}:${bar.row}`));
  const merged: GridCoord[] = [];
  for (const [col, row] of coords) {
    if (!barCells.has(`${col}:${row}`)) {
      merged.push([col + shift, row]);
    }
  }
  if (serif.mode === 'two-modules') {
    for (const [col, row] of cells) {
      merged.push([col + shift, row]);
    }
  }

  return {
    coords: sortCoords(merged),
    bars: bars.map((bar) => ({ ...bar, col: bar.col + shift })),
    width: nextWidth,
    shift,
  };
}
