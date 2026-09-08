/** Factory style library and preset (de)serialization. */

import type {
  CustomGlyph,
  CustomGlyphBank,
  CustomGlyphLibrary,
  LigatureLibrary,
  PresetFilePayload,
  PresetLibrary,
  SerifParams,
  StyleParams,
} from '../types/fontTypes';
import { DEFAULT_SERIF_PARAMS, FILL_ORDER_COLUMNS, MODULE_OVAL } from '../types/fontTypes';
import { normalizeLigatureLibrary } from '../engine/ligatures';

export const PRESET_FILE_FORMAT = 'crt-font-studio-presets-v3';

/** The reference style — every other preset is a delta on top of this. */
export const REGULAR_PARAMS: StyleParams = {
  moduleType: MODULE_OVAL,
  rx: 30,
  ry: 10,
  strokeWidth: 0,
  fillOpacity: 1,
  moduleAngle: 0,

  customSvgMarkup: '',
  customSvgName: '',

  moduleFontSubfamily: 'SB Sans Display',
  moduleFontWeight: 'Regular',
  moduleFontChars: '',
  moduleFontFillOrder: FILL_ORDER_COLUMNS,
  moduleFontRandomize: false,
  moduleFontSymbolsPerModule: 1,

  stepX: 38.5,
  stepY: 16,
  colScale: 1,
  rowScale: 1,
  letterSpacing: 1,

  slantAngle: 0,
  jitterX: 0,
  rowJitter: 0,
  seed: 0,

  fill: '#FFFFFF',
  stroke: '#FFFFFF',
  background: '#000000',
  guideColor: '#FF6B4A',
  gridColor: '#4A6A4A',
  showGuides: false,
  showGrid: false,

  serif: { ...DEFAULT_SERIF_PARAMS },

  kerningPairs: {},
};

export const DEFAULT_PRESETS: PresetLibrary = {
  Regular: { ...REGULAR_PARAMS },
  'Italic Slant': { ...REGULAR_PARAMS, slantAngle: 14 },
  'Diamond 45°': { ...REGULAR_PARAMS, moduleAngle: 45, stepX: 36, stepY: 15 },
  'Glitch CRT': {
    ...REGULAR_PARAMS,
    jitterX: 18,
    rowJitter: 12,
    seed: 42,
    strokeWidth: 0.4,
    fillOpacity: 0.95,
  },
};

/** Factory presets cannot be deleted. */
export const BUILTIN_PRESET_NAMES: readonly string[] = Object.keys(DEFAULT_PRESETS);

export const DEFAULT_PRESET_NAME = 'Regular';
export const DEFAULT_PHRASE = 'НОБЕЛЬФАЙК';

/** Specimen used for preview and export when the text field is empty. */
export function resolveSpecimen(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_PHRASE;
}

export const DEFAULT_INSPECT_CHAR = 'А';

export function freshPresetLibrary(): Record<string, StyleParams> {
  return Object.fromEntries(
    Object.entries(DEFAULT_PRESETS).map(([name, params]) => [name, { ...params }]),
  );
}

const NUMERIC_KEYS = [
  'rx',
  'ry',
  'strokeWidth',
  'fillOpacity',
  'moduleAngle',
  'moduleFontSymbolsPerModule',
  'stepX',
  'stepY',
  'colScale',
  'rowScale',
  'letterSpacing',
  'slantAngle',
  'jitterX',
  'rowJitter',
  'seed',
] as const satisfies ReadonlyArray<keyof StyleParams>;

const BOOLEAN_KEYS = [
  'moduleFontRandomize',
  'showGuides',
  'showGrid',
] as const satisfies ReadonlyArray<keyof StyleParams>;

const STRING_KEYS = [
  'moduleType',
  'customSvgMarkup',
  'customSvgName',
  'moduleFontSubfamily',
  'moduleFontWeight',
  'moduleFontChars',
  'moduleFontFillOrder',
  'fill',
  'stroke',
  'background',
  'guideColor',
  'gridColor',
] as const satisfies ReadonlyArray<keyof StyleParams>;

/** Merge untrusted partial data onto the reference style, dropping junk. */
export function normalizeParams(raw: unknown): StyleParams {
  const out: StyleParams = {
    ...REGULAR_PARAMS,
    serif: { ...DEFAULT_SERIF_PARAMS },
    kerningPairs: {},
  };
  if (!raw || typeof raw !== 'object') {
    return out;
  }
  const source = raw as Record<string, unknown>;

  for (const key of NUMERIC_KEYS) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      (out[key] as number) = value;
    }
  }
  for (const key of BOOLEAN_KEYS) {
    if (typeof source[key] === 'boolean') {
      (out[key] as boolean) = source[key] as boolean;
    }
  }
  for (const key of STRING_KEYS) {
    if (typeof source[key] === 'string') {
      (out[key] as string) = source[key] as string;
    }
  }

  if (out.moduleType !== 'oval' && out.moduleType !== 'custom_svg' && out.moduleType !== 'font_symbols') {
    out.moduleType = MODULE_OVAL;
  }
  if (out.moduleFontFillOrder !== 'columns' && out.moduleFontFillOrder !== 'rows') {
    out.moduleFontFillOrder = FILL_ORDER_COLUMNS;
  }


  const serifRaw = source.serif;
  if (serifRaw && typeof serifRaw === 'object') {
    const serifSource = serifRaw as Record<string, unknown>;
    const serif: SerifParams = { ...DEFAULT_SERIF_PARAMS };
    if (typeof serifSource.enabled === 'boolean') {
      serif.enabled = serifSource.enabled;
    }
    if (typeof serifSource.length === 'number' && Number.isFinite(serifSource.length)) {
      serif.length = Math.min(2, Math.max(1, Math.round(serifSource.length)));
    }
    if (serifSource.type === 'bilateral' || serifSource.type === 'unilateral') {
      serif.type = serifSource.type;
    }
    if (typeof serifSource.applyToCap === 'boolean') {
      serif.applyToCap = serifSource.applyToCap;
    }
    if (typeof serifSource.applyToBase === 'boolean') {
      serif.applyToBase = serifSource.applyToBase;
    }
    out.serif = serif;
  }

  const kerning = source.kerningPairs;
  if (kerning && typeof kerning === 'object') {
    const pairs: Record<string, number> = {};
    for (const [pair, delta] of Object.entries(kerning as Record<string, unknown>)) {
      if ([...pair].length === 2 && typeof delta === 'number' && Number.isFinite(delta)) {
        pairs[pair] = delta;
      }
    }
    out.kerningPairs = pairs;
  }

  return out;
}

export function presetsToJson(
  presets: PresetLibrary,
  activeName: string | null,
  customGlyphs: CustomGlyphLibrary = {},
  ligatures: LigatureLibrary = {},
): string {
  const payload: PresetFilePayload = {
    format: PRESET_FILE_FORMAT,
    active: activeName,
    presets: presets as Record<string, StyleParams>,
    customGlyphs: { ...customGlyphs },
    ligatures: { ...ligatures },
  };
  return JSON.stringify(payload, null, 2);
}

export interface ParsedPresetFile {
  presets: Record<string, StyleParams>;
  active: string | null;
  customGlyphs: CustomGlyphLibrary;
  ligatures: LigatureLibrary;
}

export function normalizeCustomGlyphs(raw: unknown): CustomGlyphLibrary {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, CustomGlyphBank> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!key) {
      continue;
    }
    const chars = [...key];
    if (chars.length === 0) {
      continue;
    }
    const ch = chars[0]!;
    const parsed = parseCustomGlyphBank(value);
    if (parsed) {
      out[ch] = parsed;
    }
  }
  return out;
}

function parseCustomGlyphBank(raw: unknown): CustomGlyphBank | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const source = raw as Record<string, unknown>;
  if (Array.isArray(source.versions)) {
    const versions: CustomGlyph[] = [];
    for (const item of source.versions) {
      const glyph = parseCustomGlyph(item);
      if (glyph) {
        versions.push(glyph);
      }
    }
    if (versions.length === 0) {
      return null;
    }
    const activeRaw =
      typeof source.active === 'number' && Number.isFinite(source.active)
        ? Math.trunc(source.active)
        : 0;
    return {
      active: Math.min(Math.max(0, activeRaw), versions.length - 1),
      versions,
    };
  }
  if (source.versions && typeof source.versions === 'object' && !Array.isArray(source.versions)) {
    const keyed = source.versions as Record<string, unknown>;
    const versions: CustomGlyph[] = [];
    for (const key of ['v1', 'v2', 'v3'] as const) {
      const glyph = parseCustomGlyph(keyed[key]);
      if (glyph) {
        versions.push(glyph);
      }
    }
    if (versions.length === 0) {
      return null;
    }
    const label = typeof source.activeVersion === 'string' ? source.activeVersion : 'v1';
    const fromLabel = Number(label.replace(/^v/i, '')) - 1;
    const active =
      Number.isFinite(fromLabel) && fromLabel >= 0
        ? Math.min(Math.trunc(fromLabel), versions.length - 1)
        : 0;
    return { active, versions };
  }
  const single = parseCustomGlyph(raw);
  if (!single) {
    return null;
  }
  return { active: 0, versions: [single] };
}

function parseCustomGlyph(raw: unknown): CustomGlyph | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const coordsRaw = Array.isArray(source.coords) ? source.coords : Array.isArray(raw) ? raw : null;
  if (!coordsRaw) {
    return null;
  }
  const coords: Array<readonly [number, number]> = [];
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
  const widthRaw = typeof source.width === 'number' && Number.isFinite(source.width) ? source.width : 0;
  let width = Math.trunc(widthRaw);
  if (width < 3) {
    let maxCol = 0;
    for (const [col] of coords) {
      if (col > maxCol) {
        maxCol = col;
      }
    }
    width = Math.max(3, maxCol + 1);
  }
  width = Math.min(9, Math.max(3, width));
  return { width, coords };
}

export function presetsFromJson(text: string): ParsedPresetFile {
  const data: unknown = JSON.parse(text);
  if (!data || typeof data !== 'object') {
    throw new Error('JSON должен быть объектом с начертаниями');
  }

  const container = data as Record<string, unknown>;
  const rawPresets =
    container.presets && typeof container.presets === 'object'
      ? (container.presets as Record<string, unknown>)
      : container;

  const presets: Record<string, StyleParams> = {};
  for (const [name, params] of Object.entries(rawPresets)) {
    if (name === 'customGlyphs' || name === 'ligatures' || name === 'format' || name === 'active') {
      continue;
    }
    const label = String(name).trim();
    if (label && params && typeof params === 'object' && !Array.isArray(params)) {
      presets[label] = normalizeParams(params);
    }
  }

  if (Object.keys(presets).length === 0) {
    throw new Error('В файле нет ни одного начертания');
  }

  const active = typeof container.active === 'string' ? container.active : null;
  return {
    presets,
    active: active && presets[active] ? active : null,
    customGlyphs: normalizeCustomGlyphs(container.customGlyphs),
    ligatures: normalizeLigatureLibrary(container.ligatures),
  };
}
