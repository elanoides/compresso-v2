/**
 * Antiqua Engine — classical modulated strokes, serifs, brackets, terminals.
 *
 * The glyph matrix is a skeleton. When antiqua is enabled we:
 *   1. Trace vertical/horizontal centreline chains
 *   2. Stroke them with W(θ) = W_thin + (W_thick − W_thin)·|sin(θ − α)|
 *   3. Attach topology-stable serif / ball / beak terminals
 *   4. Cut ink traps at acute junctions; overshoot bowls (O C G Q)
 *   5. Boolean-union everything into one PostScript-wound outline
 *
 * Serif node counts stay fixed across weight grades (100–900): extent scales
 * continuously from near-zero to full so masters interpolate cleanly.
 */

import polygonClipping from 'polygon-clipping';

import type {
  AntiquaParams,
  AntiquaStyle,
  GlyphMatrix,
  StyleParams,
} from '../types/fontTypes';
import {
  ANTIQUA_STYLE_PRESETS,
  DEFAULT_ANTIQUA_PARAMS,
} from '../types/fontTypes';
import { BASELINE, BODY_TOP, ROWS_TOTAL } from './glyphs';
import { getDensityGrade } from './nameGenerator';
import {
  contourToRing,
  ensurePostScriptWinding,
  unionPathSegments,
} from './pathBoolean';
import {
  ellipseSegments,
  type PathSegment,
  segmentsToPathData,
  splitContours,
  transformSegments,
} from './svgPath';

export const ANTIQUA_CAP_HEIGHT_ROW = BODY_TOP;
export const ANTIQUA_BASELINE_ROW = BASELINE;

const OVERSHOOT_CHARS = new Set(['O', 'C', 'G', 'Q', 'О', 'С', 'Ю']);
const BALL_TERMINAL_CHARS = new Set(['A', 'C', 'F', 'R', 'Y', 'А', 'С', 'У']);
const MIN_STEM_RUN = 3;
const EXTENT_EPSILON = 0.04;

export interface AntiquaGlyphOutline {
  segments: PathSegment[];
  advanceWidth: number;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

export function normalizeAntiquaParams(
  raw: Partial<AntiquaParams> | null | undefined,
): AntiquaParams {
  const base: AntiquaParams = { ...DEFAULT_ANTIQUA_PARAMS, ...(raw ?? {}) };
  const style: AntiquaStyle =
    base.style === 'old-style' || base.style === 'transitional' || base.style === 'modern'
      ? base.style
      : 'transitional';
  const terminalType =
    base.terminalType === 'serif' || base.terminalType === 'ball' || base.terminalType === 'beak'
      ? base.terminalType
      : 'serif';
  return {
    enabled: Boolean(base.enabled),
    style,
    contrastRatio: clamp(base.contrastRatio, 1.5, 8),
    stressAngle: clamp(base.stressAngle, -45, 45),
    serifLength: clamp(base.serifLength, 0, 2.5),
    serifThickness: clamp(base.serifThickness, 0, 1.2),
    bracketRadius: clamp(base.bracketRadius, 0, 1.5),
    terminalType,
  };
}

export function antiquaFromStyle(
  style: AntiquaStyle,
  current: AntiquaParams = DEFAULT_ANTIQUA_PARAMS,
): AntiquaParams {
  return normalizeAntiquaParams({
    ...current,
    style,
    ...ANTIQUA_STYLE_PRESETS[style],
  });
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Weight factor from optical density grade so 100→900 interpolates serif extent. */
export function antiquaWeightFactor(params: StyleParams): number {
  const grade = getDensityGrade(params);
  return clamp((grade - 80) / 420, EXTENT_EPSILON, 1);
}

/**
 * Local stroke thickness from tangent angle θ and stress axis α (radians).
 * W(θ) = W_thin + (W_thick − W_thin)·|sin(θ − α)|
 */
export function modulatedStrokeWidth(
  theta: number,
  alpha: number,
  wThick: number,
  wThin: number,
): number {
  return wThin + (wThick - wThin) * Math.abs(Math.sin(theta - alpha));
}

function occupancy(coords: GlyphMatrix, width: number): boolean[][] {
  let maxCol = Math.max(0, width - 1);
  for (const [col] of coords) {
    if (col > maxCol) maxCol = col;
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
  return grid;
}

function stemRun(
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

function isVerticalTerminal(
  grid: boolean[][],
  col: number,
  row: number,
  side: 'cap' | 'base',
): boolean {
  if (!grid[row]?.[col]) return false;
  if (side === 'base') {
    if (row + 1 < ROWS_TOTAL && grid[row + 1]?.[col]) return false;
    return stemRun(grid, col, row, -1) >= MIN_STEM_RUN;
  }
  if (row - 1 >= 0 && grid[row - 1]?.[col]) return false;
  return stemRun(grid, col, row, 1) >= MIN_STEM_RUN;
}

interface Chain {
  points: Array<[number, number]>;
  kind: 'vertical' | 'horizontal';
}

function cellCenter(
  col: number,
  row: number,
  stepX: number,
  stepY: number,
): [number, number] {
  return [col * stepX, (BASELINE - row) * stepY];
}

function extractChains(
  grid: boolean[][],
  cols: number,
  stepX: number,
  stepY: number,
): Chain[] {
  const chains: Chain[] = [];

  for (let col = 0; col < cols; col += 1) {
    let row = 0;
    while (row < ROWS_TOTAL) {
      while (row < ROWS_TOTAL && !grid[row]?.[col]) row += 1;
      if (row >= ROWS_TOTAL) break;
      const start = row;
      while (row < ROWS_TOTAL && grid[row]?.[col]) row += 1;
      const end = row - 1;
      if (end - start + 1 < 2) continue;
      const points: Array<[number, number]> = [];
      for (let r = start; r <= end; r += 1) {
        points.push(cellCenter(col, r, stepX, stepY));
      }
      chains.push({ points, kind: 'vertical' });
    }
  }

  for (let row = 0; row < ROWS_TOTAL; row += 1) {
    let col = 0;
    while (col < cols) {
      while (col < cols && !grid[row]?.[col]) col += 1;
      if (col >= cols) break;
      const start = col;
      while (col < cols && grid[row]?.[col]) col += 1;
      const end = col - 1;
      if (end - start + 1 < 3) continue;
      const points: Array<[number, number]> = [];
      for (let c = start; c <= end; c += 1) {
        points.push(cellCenter(c, row, stepX, stepY));
      }
      chains.push({ points, kind: 'horizontal' });
    }
  }

  return chains;
}

function tangentAt(points: Array<[number, number]>, index: number): number {
  const prev = points[Math.max(0, index - 1)]!;
  const next = points[Math.min(points.length - 1, index + 1)]!;
  return Math.atan2(next[1] - prev[1], next[0] - prev[0]);
}

function strokeChain(
  points: Array<[number, number]>,
  antiqua: AntiquaParams,
  wThick: number,
  wThin: number,
): PathSegment[] {
  if (points.length < 2) return [];
  const alpha = (antiqua.stressAngle * Math.PI) / 180;
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];

  for (let i = 0; i < points.length; i += 1) {
    const theta = tangentAt(points, i);
    const w = modulatedStrokeWidth(theta, alpha, wThick, wThin);
    const nx = -Math.sin(theta);
    const ny = Math.cos(theta);
    const [x, y] = points[i]!;
    left.push([x + nx * (w / 2), y + ny * (w / 2)]);
    right.push([x - nx * (w / 2), y - ny * (w / 2)]);
  }

  const out: PathSegment[] = [{ type: 'M', x: left[0]![0], y: left[0]![1] }];
  for (let i = 1; i < left.length; i += 1) {
    out.push({ type: 'L', x: left[i]![0], y: left[i]![1] });
  }
  for (let i = right.length - 1; i >= 0; i -= 1) {
    out.push({ type: 'L', x: right[i]![0], y: right[i]![1] });
  }
  out.push({ type: 'Z' });
  return out;
}

/**
 * Topology-stable serif at a vertical stem terminal.
 * Same cubic count always; extents scale with weightFactor.
 */
function serifContour(
  x: number,
  y: number,
  side: 'cap' | 'base',
  stemHalf: number,
  antiqua: AntiquaParams,
  weightFactor: number,
  beakDir: -1 | 0 | 1,
): PathSegment[] {
  const len = Math.max(EXTENT_EPSILON, antiqua.serifLength * stemHalf * 2 * weightFactor);
  const thick = Math.max(EXTENT_EPSILON, antiqua.serifThickness * stemHalf * 2 * weightFactor);
  const bracket = Math.max(0, antiqua.bracketRadius * stemHalf * 2 * weightFactor);
  const outward = side === 'base' ? -1 : 1;
  const yFace = y + outward * thick;
  const leftLen = beakDir === 1 ? EXTENT_EPSILON * stemHalf : len;
  const rightLen = beakDir === -1 ? EXTENT_EPSILON * stemHalf : len;
  const xL = x - stemHalf - leftLen;
  const xR = x + stemHalf + rightLen;
  const xStemL = x - stemHalf;
  const xStemR = x + stemHalf;
  const bevelL = side === 'cap' ? Math.tan((17 * Math.PI) / 180) * leftLen : 0;
  const bevelR = side === 'cap' ? Math.tan((17 * Math.PI) / 180) * rightLen : 0;
  const yLTip = side === 'cap' ? yFace - bevelL : yFace;
  const yRTip = side === 'cap' ? yFace - bevelR : yFace;

  if (bracket <= 1e-6) {
    return [
      { type: 'M', x: xStemL, y },
      { type: 'C', x1: xStemL, y1: y, x2: xL, y2: yFace, x: xL, y: yLTip },
      { type: 'C', x1: xL, y1: yLTip, x2: xR, y2: yRTip, x: xR, y: yRTip },
      { type: 'C', x1: xR, y1: yRTip, x2: xStemR, y2: y, x: xStemR, y },
      { type: 'C', x1: xStemR, y1: y, x2: xStemL, y2: y, x: xStemL, y },
      { type: 'Z' },
    ];
  }

  const b = bracket;
  return [
    { type: 'M', x: xStemL, y },
    {
      type: 'C',
      x1: xStemL,
      y1: y + outward * b * 0.55,
      x2: xL + b,
      y2: yFace,
      x: xL,
      y: yLTip,
    },
    { type: 'C', x1: xL, y1: yLTip, x2: xR, y2: yRTip, x: xR, y: yRTip },
    {
      type: 'C',
      x1: xR - b,
      y1: yFace,
      x2: xStemR,
      y2: y + outward * b * 0.55,
      x: xStemR,
      y,
    },
    { type: 'C', x1: xStemR, y1: y, x2: xStemL, y2: y, x: xStemL, y },
    { type: 'Z' },
  ];
}

function ballTerminal(x: number, y: number, radius: number): PathSegment[] {
  return ellipseSegments(x, y, Math.max(EXTENT_EPSILON, radius), Math.max(EXTENT_EPSILON, radius) * 1.15);
}

function inkTrapTriangle(x: number, y: number, size: number): PathSegment[] {
  const s = Math.max(EXTENT_EPSILON, size);
  return [
    { type: 'M', x, y },
    { type: 'L', x: x - s, y: y + s },
    { type: 'L', x: x + s, y: y + s },
    { type: 'Z' },
  ];
}

function findAcuteJunctions(
  grid: boolean[][],
  cols: number,
  stepX: number,
  stepY: number,
): Array<[number, number]> {
  const traps: Array<[number, number]> = [];
  for (let row = 1; row < ROWS_TOTAL - 1; row += 1) {
    for (let col = 1; col < cols - 1; col += 1) {
      if (!grid[row]?.[col]) continue;
      const n = grid[row - 1]?.[col] ? 1 : 0;
      const s = grid[row + 1]?.[col] ? 1 : 0;
      const e = grid[row]?.[col + 1] ? 1 : 0;
      const w = grid[row]?.[col - 1] ? 1 : 0;
      const ne = grid[row - 1]?.[col + 1] ? 1 : 0;
      const nw = grid[row - 1]?.[col - 1] ? 1 : 0;
      const se = grid[row + 1]?.[col + 1] ? 1 : 0;
      const sw = grid[row + 1]?.[col - 1] ? 1 : 0;
      const diagonalFork =
        (ne && sw && !e && !w) ||
        (nw && se && !e && !w) ||
        (n && e && !ne) ||
        (n && w && !nw) ||
        (s && e && !se) ||
        (s && w && !sw);
      if (diagonalFork) {
        traps.push(cellCenter(col, row, stepX, stepY));
      }
    }
  }
  return traps;
}

function bboxOf(segments: readonly PathSegment[]): {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
} {
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const seg of segments) {
    if (seg.type === 'Z') continue;
    xMin = Math.min(xMin, seg.x);
    xMax = Math.max(xMax, seg.x);
    yMin = Math.min(yMin, seg.y);
    yMax = Math.max(yMax, seg.y);
    if (seg.type === 'C') {
      xMin = Math.min(xMin, seg.x1, seg.x2);
      xMax = Math.max(xMax, seg.x1, seg.x2);
      yMin = Math.min(yMin, seg.y1, seg.y2);
      yMax = Math.max(yMax, seg.y1, seg.y2);
    }
  }
  if (!Number.isFinite(xMin)) {
    return { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
  }
  return { xMin, xMax, yMin, yMax };
}

function differenceAll(base: PathSegment[], cuts: PathSegment[][]): PathSegment[] {
  const baseRings: Array<Array<[number, number]>> = [];
  for (const contour of splitContours(base)) {
    const ring = contourToRing(contour);
    if (ring) baseRings.push(ring);
  }
  if (baseRings.length === 0) return base;

  let subject: Array<Array<Array<[number, number]>>> = baseRings.map((ring) => [ring]);
  for (const cut of cuts) {
    const cutRing = contourToRing(cut);
    if (!cutRing) continue;
    try {
      subject = polygonClipping.difference(subject as never, [[cutRing]] as never) as typeof subject;
    } catch {
      // keep subject
    }
  }

  const out: PathSegment[] = [];
  for (const poly of subject) {
    for (const ring of poly) {
      if (ring.length < 4) continue;
      out.push({ type: 'M', x: ring[0]![0], y: ring[0]![1] });
      for (let i = 1; i < ring.length - 1; i += 1) {
        out.push({ type: 'L', x: ring[i]![0], y: ring[i]![1] });
      }
      out.push({ type: 'Z' });
    }
  }
  return out.length > 0 ? out : base;
}

/**
 * Build the full antiqua outline for one glyph in font units (Y-up from baseline).
 */
export function buildAntiquaOutline(
  ch: string,
  coords: GlyphMatrix,
  glyphWidthCols: number,
  params: StyleParams,
): AntiquaGlyphOutline | null {
  const antiqua = normalizeAntiquaParams(params.antiqua);
  if (!antiqua.enabled || coords.length === 0) {
    return null;
  }

  const stepX = params.stepX;
  const stepY = params.stepY;
  const grid = occupancy(coords, glyphWidthCols);
  const cols = grid[0]?.length ?? glyphWidthCols;
  const weight = antiquaWeightFactor(params);

  const wThick = Math.max(params.rx * 0.9, stepX * 0.28) * (0.55 + 0.45 * weight);
  const wThin = Math.max(wThick / antiqua.contrastRatio, stepX * 0.04);
  const stemHalf = wThick / 2;

  const pieces: PathSegment[] = [];
  const chains = extractChains(grid, cols, stepX, stepY);

  for (const chain of chains) {
    let pts = chain.points;
    if (OVERSHOOT_CHARS.has(ch) && chain.kind === 'vertical' && pts.length >= 2) {
      const overshoot = stepY * 0.12 * weight;
      const first = pts[0]!;
      const last = pts[pts.length - 1]!;
      pts = [[first[0], first[1] + overshoot], ...pts, [last[0], last[1] - overshoot]];
    }
    pieces.push(...strokeChain(pts, antiqua, wThick, wThin));
  }

  const centerCol = (cols - 1) / 2;
  for (let col = 0; col < cols; col += 1) {
    for (const side of ['base', 'cap'] as const) {
      const row = side === 'base' ? ANTIQUA_BASELINE_ROW : ANTIQUA_CAP_HEIGHT_ROW;
      if (!isVerticalTerminal(grid, col, row, side)) continue;
      const [x, y] = cellCenter(col, row, stepX, stepY);
      const beakDir: -1 | 0 | 1 =
        antiqua.terminalType === 'beak' ? (col <= centerCol ? -1 : 1) : 0;

      if (antiqua.terminalType === 'ball' && BALL_TERMINAL_CHARS.has(ch) && side === 'cap') {
        pieces.push(
          ...ballTerminal(
            x,
            y + stemHalf * 0.6,
            Math.max(EXTENT_EPSILON, stemHalf * 1.1 * weight),
          ),
        );
      } else {
        pieces.push(...serifContour(x, y, side, stemHalf, antiqua, weight, beakDir));
      }
    }
  }

  if (
    (antiqua.terminalType === 'ball' || antiqua.terminalType === 'beak') &&
    BALL_TERMINAL_CHARS.has(ch)
  ) {
    outer: for (let row = BODY_TOP + 2; row < BASELINE - 2; row += 1) {
      for (let col = cols - 1; col >= 0; col -= 1) {
        if (!grid[row]?.[col]) continue;
        const rightOpen = col + 1 >= cols || !grid[row]?.[col + 1];
        const leftFilled = col > 0 && Boolean(grid[row]?.[col - 1]);
        if (rightOpen && leftFilled) {
          const [x, y] = cellCenter(col, row, stepX, stepY);
          pieces.push(
            ...ballTerminal(
              x + stemHalf,
              y,
              Math.max(
                EXTENT_EPSILON,
                stemHalf * (antiqua.terminalType === 'ball' ? 1.2 : 0.7) * weight,
              ),
            ),
          );
          break outer;
        }
        break;
      }
    }
  }

  let united = unionPathSegments(pieces);

  const traps = findAcuteJunctions(grid, cols, stepX, stepY);
  if (traps.length > 0 && united.length > 0) {
    const cuts = traps.map(([tx, ty]) => inkTrapTriangle(tx, ty, stemHalf * 0.35 * weight));
    united = differenceAll(united, cuts);
  }

  united = ensurePostScriptWinding(united);
  const box = bboxOf(united);
  const advance = Math.max(
    glyphWidthCols * stepX + params.letterSpacing * stepX,
    box.xMax + stepX * 0.15,
    stepX,
  );

  return {
    segments: united,
    advanceWidth: advance,
    xMin: box.xMin,
    xMax: box.xMax,
    yMin: box.yMin,
    yMax: box.yMax,
  };
}

/** SVG path `d` for live preview (Y-down). */
export function antiquaOutlineToSvgPath(
  outline: AntiquaGlyphOutline,
  originX: number,
  originY: number,
  minRow: number,
  stepY: number,
): string {
  return segmentsToPathData(antiquaToSvgSegments(outline, originX, originY, minRow, stepY));
}

export function antiquaToSvgSegments(
  outline: AntiquaGlyphOutline,
  originX: number,
  originY: number,
  minRow: number,
  stepY: number,
): PathSegment[] {
  const baselineSvgY = originY + (BASELINE - minRow) * stepY;
  return transformSegments(outline.segments, [1, 0, 0, -1, originX, baselineSvgY]);
}

export function antiquaAdvanceCols(
  width: number,
  params: StyleParams,
): number {
  const antiqua = normalizeAntiquaParams(params.antiqua);
  if (!antiqua.enabled) return width;
  const weight = antiquaWeightFactor(params);
  const extra = Math.ceil(Math.max(EXTENT_EPSILON, antiqua.serifLength) * weight);
  return width + extra * 2;
}
