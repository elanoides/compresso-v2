/**
 * Style names from live parameters: Condensed Light Slab Diamond Italic Glitch.
 * Collisions resolve with optical density grades 100–900 (then ±10 / ±25).
 */

import { REGULAR_PARAMS } from '../data/presets';
import {
  MODULE_CUSTOM_SVG,
  MODULE_FONT,
  type StyleParams,
} from '../types/fontTypes';

const CONDENSED_STEP_X = 28;
const EXPANDED_STEP_X = 48;
const BASE_AREA = REGULAR_PARAMS.rx * REGULAR_PARAMS.ry;
const LIGHT_AREA = BASE_AREA * 0.88;
const BOLD_AREA = BASE_AREA * 1.12;
const BLACK_AREA = BASE_AREA * 1.8;
const ANGLE_EPS = 0.5;
const SLANT_EPS = 0.05;
const FX_EPS = 0.05;

const DENSITY_MIN = 0.1;
const DENSITY_MAX = 1.5;
const GRADE_FLOOR = 100;
const GRADE_CEILING = 900;
const GRADE_SNAP = 50;
const FINE_GRADE_STEP = 10;
const COARSE_GRADE_STEP = 25;
const COARSE_STEP_THRESHOLD = 8;

function diamondAngle(angle: number): boolean {
  return Math.abs(Math.abs(angle) - 45) < ANGLE_EPS;
}

/** Tokens that describe the current sliders, without uniqueness suffixes. */
export function styleNameFromParams(params: StyleParams): string {
  return getBaseName(params);
}

/** Base name from parameters — e.g. `Expanded Light`. */
export function getBaseName(params: StyleParams): string {
  const tokens: string[] = [];

  if (params.stepX < CONDENSED_STEP_X) {
    tokens.push('Condensed');
  } else if (params.stepX > EXPANDED_STEP_X) {
    tokens.push('Expanded');
  }

  const area = params.rx * params.ry;
  if (area < LIGHT_AREA) {
    tokens.push('Light');
  } else if (area > BLACK_AREA) {
    tokens.push('Black');
  } else if (area > BOLD_AREA) {
    tokens.push('Bold');
  }

  if (params.serif.enabled) {
    tokens.push(params.serif.mode === 'single-stretched' ? 'Slab' : 'Serif');
  }

  if (diamondAngle(params.moduleAngle)) {
    tokens.push('Diamond');
  }
  if (params.moduleType === MODULE_CUSTOM_SVG) {
    tokens.push('Vector');
  } else if (params.moduleType === MODULE_FONT) {
    tokens.push('Typo');
  }

  if (params.slantAngle > SLANT_EPS) {
    tokens.push('Italic');
  } else if (params.slantAngle < -SLANT_EPS) {
    tokens.push('Backslant');
  }

  if (Math.abs(params.jitterX) > FX_EPS || Math.abs(params.rowJitter) > FX_EPS) {
    tokens.push('Glitch');
  }

  return tokens.length > 0 ? tokens.join(' ') : 'Regular';
}

/** Optical density: module ellipse area over one grid cell. */
export function opticalDensity(params: StyleParams): number {
  const cell = params.stepX * params.stepY;
  if (!(cell > 0) || !Number.isFinite(cell)) {
    return 0;
  }
  return (Math.PI * params.rx * params.ry) / cell;
}

/**
 * Map optical density onto the 100–900 scale, snapped to 50
 * (100, 150, 200 … 900). Typical studio range: 0.1 sparse → 1.5 overlap.
 */
export function getDensityGrade(params: StyleParams): number {
  const rawDensity = opticalDensity(params);
  const span = DENSITY_MAX - DENSITY_MIN;
  const normalized = Math.min(Math.max((rawDensity - DENSITY_MIN) / span, 0), 1);
  const grade = Math.round((normalized * 800 + GRADE_FLOOR) / GRADE_SNAP) * GRADE_SNAP;
  return Math.max(GRADE_FLOOR, Math.min(GRADE_CEILING, grade));
}

const GRADE_SUFFIX = /^(.*)\s+(\d{2,3})$/;

/** Parse `Expanded Light 150` → family + numeric grade. */
export function parseGradeSuffix(name: string): { family: string; grade: number } | null {
  const match = GRADE_SUFFIX.exec(name);
  if (!match) {
    return null;
  }
  const grade = Number(match[2]);
  if (!Number.isFinite(grade) || grade < 10 || grade > 999) {
    return null;
  }
  return { family: match[1]!, grade };
}

function familyOf(name: string, params?: StyleParams): string {
  if (params) {
    return getBaseName(params);
  }
  return parseGradeSuffix(name)?.family ?? name;
}

function gradeOf(name: string, params?: StyleParams): number {
  const parsed = parseGradeSuffix(name);
  if (parsed) {
    return parsed.grade;
  }
  if (params) {
    return getDensityGrade(params);
  }
  return -1;
}

/**
 * Group same-family styles together, then order thin → dense (100 → 900).
 */
export function sortPresetNames(
  names: readonly string[],
  presets?: Readonly<Record<string, StyleParams>>,
): string[] {
  const keys = new Map(
    names.map((name) => {
      const params = presets?.[name];
      return [name, { family: familyOf(name, params), grade: gradeOf(name, params) }] as const;
    }),
  );
  return [...names].sort((a, b) => {
    const keyA = keys.get(a)!;
    const keyB = keys.get(b)!;
    const familyCmp = keyA.family.localeCompare(keyB.family, 'ru');
    if (familyCmp !== 0) {
      return familyCmp;
    }
    if (keyA.grade !== keyB.grade) {
      return keyA.grade - keyB.grade;
    }
    return a.localeCompare(b, 'ru');
  });
}

function stepSpread(a: StyleParams, b: StyleParams): number {
  return Math.abs(a.stepX - b.stepX) + Math.abs(a.stepY - b.stepY);
}

function gradeIncrement(params: StyleParams, sibling: StyleParams | undefined): number {
  if (!sibling) {
    return FINE_GRADE_STEP;
  }
  return stepSpread(params, sibling) >= COARSE_STEP_THRESHOLD ? COARSE_GRADE_STEP : FINE_GRADE_STEP;
}

function densityDirection(params: StyleParams, sibling: StyleParams | undefined): 1 | -1 {
  if (!sibling) {
    return 1;
  }
  return opticalDensity(params) >= opticalDensity(sibling) ? 1 : -1;
}

function siblingAtGrade(
  base: string,
  grade: number,
  existingPresets?: Readonly<Record<string, StyleParams>>,
): StyleParams | undefined {
  return existingPresets?.[`${base} ${grade}`];
}

function nextOpenGradeName(
  base: string,
  grade: number,
  params: StyleParams,
  taken: ReadonlySet<string>,
  existingPresets?: Readonly<Record<string, StyleParams>>,
): string {
  const primary = `${base} ${grade}`;
  if (!taken.has(primary)) {
    return primary;
  }

  const sibling = siblingAtGrade(base, grade, existingPresets);
  const increment = gradeIncrement(params, sibling);
  const direction = densityDirection(params, sibling);

  const tryOffset = (sign: 1 | -1): string | null => {
    for (let step = 1; step <= 80; step += 1) {
      const candidate = grade + sign * increment * step;
      if (candidate < 50 || candidate > 950) {
        continue;
      }
      const name = `${base} ${candidate}`;
      if (!taken.has(name)) {
        return name;
      }
    }
    return null;
  };

  return (
    tryOffset(direction) ??
    tryOffset(direction === 1 ? -1 : 1) ??
    fallbackUniqueName(base, grade, taken)
  );
}

function fallbackUniqueName(base: string, grade: number, taken: ReadonlySet<string>): string {
  for (let candidate = 50; candidate <= 950; candidate += 5) {
    const name = `${base} ${candidate}`;
    if (!taken.has(name)) {
      return name;
    }
  }
  let serial = 2;
  let name = `${base} ${grade} ${paddedIndex(serial)}`;
  while (taken.has(name)) {
    serial += 1;
    name = `${base} ${grade} ${paddedIndex(serial)}`;
  }
  return name;
}

function paddedIndex(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Unique name from parameters:
 * 1. baseName if free
 * 2. `[BaseName] [Grade]` on the 100–900 scale
 * 3. nearby grade ±10 / ±25 if that slot is taken
 */
export function generateStyleName(
  params: StyleParams,
  existingNames: readonly string[],
  existingPresets?: Readonly<Record<string, StyleParams>>,
): string {
  const taken = new Set(existingNames);
  const base = getBaseName(params);

  if (!taken.has(base)) {
    return base;
  }

  const grade = getDensityGrade(params);
  return nextOpenGradeName(base, grade, params, taken, existingPresets);
}

/** Smart name from live sliders; uses the library when provided. */
export function suggestPresetName(
  params: StyleParams,
  existingNames: readonly string[] = [],
  existingPresets?: Readonly<Record<string, StyleParams>>,
): string {
  if (existingNames.length === 0 && !existingPresets) {
    return getBaseName(params);
  }
  return generateStyleName(params, existingNames, existingPresets);
}

/** Next free serial name: Style 01, Style 02, Style 03, … */
export function nextOrdinalStyleName(existingNames: readonly string[]): string {
  const taken = new Set(existingNames);
  let n = 1;
  let candidate = `Style ${paddedIndex(n)}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `Style ${paddedIndex(n)}`;
  }
  return candidate;
}

/** First free name: `base`, then density grades when params are known. */
export function uniqueStyleName(
  base: string,
  existingNames: readonly string[],
  params?: StyleParams,
  existingPresets?: Readonly<Record<string, StyleParams>>,
): string {
  if (params) {
    return generateStyleName(params, existingNames, existingPresets);
  }

  const taken = new Set(existingNames);
  if (!taken.has(base)) {
    return base;
  }
  let n = 2;
  let candidate = `${base} ${paddedIndex(n)}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base} ${paddedIndex(n)}`;
  }
  return candidate;
}
