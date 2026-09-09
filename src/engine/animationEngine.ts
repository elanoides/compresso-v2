/**
 * Keyframe interpolation for parametric style morphs.
 *
 * Numeric and colour fields lerp. Discrete topology (module type, SVG, font
 * face, serif on/off/mode) snaps at t = 0.5. Kerning and per-style glyph
 * libraries are never morphed — callers pin those to the first keyframe.
 */

import type { CustomGlyphLibrary, StyleParams } from '../types/fontTypes';
import { getGlyph, glyphWidth, ROWS_TOTAL } from './glyphs';
import { applySlabSerifs } from './serifEngine';

export interface KeyframeState {
  rx: number;
  ry: number;
  strokeWidth: number;
  fillOpacity: number;
  letterSpacing: number;
  stepX: number;
  stepY: number;
  colScale: number;
  rowScale: number;
  serifEnabled: boolean;
  serifMode: 'single-stretched' | 'two-modules';
  cols?: number;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export type EasingFunction = 'linear' | 'easeInOutSine' | 'easeInOutCubic' | 'pingPong';

export const EASING_LABELS: ReadonlyArray<{ value: EasingFunction; label: string }> = [
  { value: 'pingPong', label: 'Ping-Pong' },
  { value: 'easeInOutSine', label: 'Ease In-Out Sine' },
  { value: 'easeInOutCubic', label: 'Ease In-Out Cubic' },
  { value: 'linear', label: 'Linear' },
];

export function applyEasing(t: number, easing: EasingFunction): number {
  const u = Math.min(1, Math.max(0, t));
  switch (easing) {
    case 'easeInOutSine':
      return -(Math.cos(Math.PI * u) - 1) / 2;
    case 'easeInOutCubic':
      return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    case 'pingPong':
      return (1 - Math.cos(2 * Math.PI * u)) / 2;
    case 'linear':
    default:
      return u;
  }
}

export function interpolateKeyframes(
  from: KeyframeState,
  to: KeyframeState,
  t: number,
): KeyframeState {
  const u = Math.min(1, Math.max(0, t));
  const cols =
    from.cols !== undefined && to.cols !== undefined ? lerp(from.cols, to.cols, u) : from.cols ?? to.cols;
  return {
    rx: lerp(from.rx, to.rx, u),
    ry: lerp(from.ry, to.ry, u),
    strokeWidth: lerp(from.strokeWidth, to.strokeWidth, u),
    fillOpacity: lerp(from.fillOpacity, to.fillOpacity, u),
    letterSpacing: lerp(from.letterSpacing, to.letterSpacing, u),
    stepX: lerp(from.stepX, to.stepX, u),
    stepY: lerp(from.stepY, to.stepY, u),
    colScale: Math.max(1, Math.round(lerp(from.colScale, to.colScale, u))),
    rowScale: Math.max(1, Math.round(lerp(from.rowScale, to.rowScale, u))),
    serifEnabled: u > 0.5 ? to.serifEnabled : from.serifEnabled,
    serifMode: u > 0.5 ? to.serifMode : from.serifMode,
    ...(cols !== undefined ? { cols } : {}),
  };
}

export function keyframeFromParams(params: StyleParams): KeyframeState {
  return {
    rx: params.rx,
    ry: params.ry,
    strokeWidth: params.strokeWidth,
    fillOpacity: params.fillOpacity,
    letterSpacing: params.letterSpacing,
    stepX: params.stepX,
    stepY: params.stepY,
    colScale: params.colScale,
    rowScale: params.rowScale,
    serifEnabled: params.serif.enabled,
    serifMode: params.serif.mode,
  };
}

function parseHexColor(input: string): [number, number, number] | null {
  const raw = input.trim();
  const short = /^#([0-9a-fA-F]{3})$/.exec(raw);
  if (short) {
    const [r, g, b] = short[1]!.split('');
    return [parseInt(r! + r, 16), parseInt(g! + g, 16), parseInt(b! + b, 16)];
  }
  const full = /^#([0-9a-fA-F]{6})$/.exec(raw);
  if (!full) {
    return null;
  }
  const hex = full[1]!;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function toHexColor(r: number, g: number, b: number): string {
  const channel = (value: number) =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0');
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** Lerp two CSS hex colours; non-hex values snap at the midpoint. */
export function lerpColor(from: string, to: string, t: number): string {
  const a = parseHexColor(from);
  const b = parseHexColor(to);
  if (!a || !b) {
    return t > 0.5 ? to : from;
  }
  return toHexColor(lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t));
}

/**
 * Full style morph for preview and video frames.
 *
 * Animates every StyleParams field that can be interpolated.
 * Does NOT morph kerning (held from the segment start).
 * Glyph/ligature libraries are chosen outside this function and must stay fixed.
 *
 * Discrete topology (module type, SVG markup, font face, serif mode/flag,
 * boolean guides) snaps at t = 0.5 so the mesh stays valid on each half.
 */
export function interpolateStyleParams(from: StyleParams, to: StyleParams, t: number): StyleParams {
  const u = Math.min(1, Math.max(0, t));
  const snap = u > 0.5 ? to : from;
  return {
    ...snap,
    rx: lerp(from.rx, to.rx, u),
    ry: lerp(from.ry, to.ry, u),
    strokeWidth: lerp(from.strokeWidth, to.strokeWidth, u),
    fillOpacity: lerp(from.fillOpacity, to.fillOpacity, u),
    moduleAngle: lerp(from.moduleAngle, to.moduleAngle, u),
    stepX: lerp(from.stepX, to.stepX, u),
    stepY: lerp(from.stepY, to.stepY, u),
    colScale: Math.max(1, Math.round(lerp(from.colScale, to.colScale, u))),
    rowScale: Math.max(1, Math.round(lerp(from.rowScale, to.rowScale, u))),
    letterSpacing: lerp(from.letterSpacing, to.letterSpacing, u),
    slantAngle: lerp(from.slantAngle, to.slantAngle, u),
    jitterX: lerp(from.jitterX, to.jitterX, u),
    rowJitter: lerp(from.rowJitter, to.rowJitter, u),
    seed: Math.round(lerp(from.seed, to.seed, u)),
    moduleFontSymbolsPerModule: Math.max(
      1,
      Math.round(lerp(from.moduleFontSymbolsPerModule, to.moduleFontSymbolsPerModule, u)),
    ),
    fill: lerpColor(from.fill, to.fill, u),
    stroke: lerpColor(from.stroke, to.stroke, u),
    background: lerpColor(from.background, to.background, u),
    guideColor: lerpColor(from.guideColor, to.guideColor, u),
    gridColor: lerpColor(from.gridColor, to.gridColor, u),
    serif: {
      enabled: u > 0.5 ? to.serif.enabled : from.serif.enabled,
      mode: u > 0.5 ? to.serif.mode : from.serif.mode,
    },
    // Kerning is never animated — keep the start of the segment.
    kerningPairs: from.kerningPairs,
  };
}

/** One stop on the animation timeline — always points at a saved preset name. */
export interface TimelineKeyframe {
  id: string;
  presetName: string;
}

export interface TimelineSample {
  fromName: string;
  toName: string;
  /** Local blend inside the active segment, already in 0…1. */
  localT: number;
  segmentIndex: number;
  segmentCount: number;
}

/**
 * Map a global playhead `t` (0…1, after easing) onto consecutive keyframes.
 * Equal time per segment: KF1→KF2→…→KFn.
 */
export function sampleTimeline(
  keyframes: readonly TimelineKeyframe[],
  t: number,
): TimelineSample | null {
  if (keyframes.length === 0) {
    return null;
  }
  const u = Math.min(1, Math.max(0, t));
  if (keyframes.length === 1) {
    const only = keyframes[0]!;
    return {
      fromName: only.presetName,
      toName: only.presetName,
      localT: 0,
      segmentIndex: 0,
      segmentCount: 1,
    };
  }
  const segmentCount = keyframes.length - 1;
  const scaled = u * segmentCount;
  const segmentIndex = Math.min(segmentCount - 1, Math.floor(scaled));
  const localT = Math.min(1, Math.max(0, scaled - segmentIndex));
  const from = keyframes[segmentIndex]!;
  const to = keyframes[segmentIndex + 1]!;
  return {
    fromName: from.presetName,
    toName: to.presetName,
    localT,
    segmentIndex,
    segmentCount,
  };
}

export function interpolateKeyframeStates(
  frames: readonly KeyframeState[],
  t: number,
): KeyframeState {
  if (frames.length === 0) {
    throw new Error('Нужен хотя бы один ключевой кадр');
  }
  if (frames.length === 1) {
    return frames[0]!;
  }
  const u = Math.min(1, Math.max(0, t));
  const segmentCount = frames.length - 1;
  const scaled = u * segmentCount;
  const index = Math.min(segmentCount - 1, Math.floor(scaled));
  const localT = Math.min(1, Math.max(0, scaled - index));
  return interpolateKeyframes(frames[index]!, frames[index + 1]!, localT);
}

export function newTimelineKeyframeId(): string {
  return `kf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Occupancy matrix for one character, including modular serifs. */
export function glyphOccupancyGrid(
  ch: string,
  params: StyleParams,
  custom: CustomGlyphLibrary,
): boolean[][] {
  const base = getGlyph(ch, params.colScale, params.rowScale, custom);
  const baseCols = glyphWidth(ch, custom) * Math.max(1, params.colScale);
  const seriffed = applySlabSerifs(ch, base, baseCols, params.serif, params.colScale);
  const cols = Math.max(1, seriffed.width);
  const grid: boolean[][] = Array.from({ length: ROWS_TOTAL }, () =>
    Array.from({ length: cols }, () => false),
  );

  const light = (col: number, row: number) => {
    if (row >= 0 && row < ROWS_TOTAL && col >= 0 && col < cols) {
      grid[row]![col] = true;
    }
  };

  for (const [col, row] of seriffed.coords) {
    light(col, row);
  }
  for (const bar of seriffed.bars) {
    const left = bar.serif?.left ?? 0;
    const right = bar.serif?.right ?? 0;
    for (let step = -left; step <= right; step += 1) {
      light(bar.col + step, bar.row);
    }
  }
  return grid;
}

export function occupancyForText(
  text: string,
  params: StyleParams,
  custom: CustomGlyphLibrary,
): Record<string, boolean[][]> {
  const grids: Record<string, boolean[][]> = {};
  for (const ch of text) {
    if (ch === ' ' || ch in grids) {
      continue;
    }
    grids[ch] = glyphOccupancyGrid(ch, params, custom);
  }
  return grids;
}
