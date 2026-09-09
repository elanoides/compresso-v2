/** Core domain types for the CRT Parametric Font Studio engine. */

/** One module slot on the 28-row grid: `[column, row]`. */
export type GridCoord = readonly [number, number];

/** All module slots of a single glyph. */
export type GlyphMatrix = readonly GridCoord[];

export const MODULE_OVAL = 'oval';
export const MODULE_CUSTOM_SVG = 'custom_svg';
export const MODULE_FONT = 'font_symbols';

export type ModuleType =
  | typeof MODULE_OVAL
  | typeof MODULE_CUSTOM_SVG
  | typeof MODULE_FONT;

export const FILL_ORDER_COLUMNS = 'columns';
export const FILL_ORDER_ROWS = 'rows';

export type FillOrder = typeof FILL_ORDER_COLUMNS | typeof FILL_ORDER_ROWS;

/** Kerning deltas in grid-column units, keyed by a two-character pair. */
export type KerningPairs = Readonly<Record<string, number>>;

/**
 * How a serif is drawn at a stem terminal.
 * `single-stretched` — one module stretched sideways into a bar under the stem.
 * `two-modules` — one plain module lit left and right of the stem.
 */
export type SerifMode = 'single-stretched' | 'two-modules';

/** Serif controls for one style. */
export interface SerifSettings {
  enabled: boolean;
  mode: SerifMode;
}

export const DEFAULT_SERIF_SETTINGS: SerifSettings = {
  enabled: false,
  mode: 'two-modules',
};

/** How far a stretched serif bar reaches from its stem cell, in grid cells. */
export interface SerifReach {
  left: number;
  right: number;
}

/**
 * Every parameter that defines one style (начертание).
 * This object is what gets stored in a preset, serialized to JSON and
 * fed to the geometry engine.
 */
export interface StyleParams {
  // Module geometry
  moduleType: ModuleType;
  rx: number;
  ry: number;
  strokeWidth: number;
  fillOpacity: number;
  moduleAngle: number;

  // Custom SVG module
  customSvgMarkup: string;
  customSvgName: string;

  // Font-symbol module
  moduleFontSubfamily: string;
  moduleFontWeight: string;
  moduleFontChars: string;
  moduleFontFillOrder: FillOrder;
  moduleFontRandomize: boolean;
  moduleFontSymbolsPerModule: number;

  // Spacing & density
  stepX: number;
  stepY: number;
  colScale: number;
  rowScale: number;
  letterSpacing: number;

  // Deformations & FX
  slantAngle: number;
  jitterX: number;
  rowJitter: number;
  seed: number;

  // Colour & guides
  fill: string;
  stroke: string;
  background: string;
  guideColor: string;
  gridColor: string;
  showGuides: boolean;
  showGrid: boolean;

  // Serifs
  serif: SerifSettings;

  // Kerning
  kerningPairs: KerningPairs;
}

/** A named style in the preset library. */
export interface Preset {
  name: string;
  params: StyleParams;
}

export type PresetLibrary = Readonly<Record<string, StyleParams>>;

/** User-edited or user-created glyph matrix (unscaled base grid). */
export interface CustomGlyph {
  width: number;
  coords: GlyphMatrix;
}

/**
 * Saved versions of one character.
 * `versions[0]` is v1 (default Unicode glyph); `versions[1]` is v2 / `ss01`;
 * `versions[2]` is v3 / `ss02`. Inspector `active` picks which matrix is edited.
 * Text layout and OTF default to v1 unless a stylistic set is requested.
 */
export interface CustomGlyphBank {
  active: number;
  versions: readonly CustomGlyph[];
}

export type CustomGlyphLibrary = Readonly<Record<string, CustomGlyphBank>>;

/** User-defined OpenType ligature: trigger sequence → merged module matrix. */
export interface Ligature {
  trigger: string;
  width: number;
  coords: GlyphMatrix;
}

export type LigatureLibrary = Readonly<Record<string, Ligature>>;

/** On-disk JSON shape for preset import / export. */
export interface PresetFilePayload {
  format: string;
  active: string | null;
  presets: Record<string, Partial<StyleParams>>;
  /** @deprecated Prefer glyphsByStyle — kept for older JSON files. */
  customGlyphs?: Record<string, CustomGlyphBank>;
  /** @deprecated Prefer ligaturesByStyle — kept for older JSON files. */
  ligatures?: Record<string, Ligature>;
  /** Per-style glyph overrides keyed by начертание name. */
  glyphsByStyle?: Record<string, Record<string, CustomGlyphBank>>;
  /** Per-style ligatures keyed by начертание name. */
  ligaturesByStyle?: Record<string, Record<string, Ligature>>;
}

/** Snapshot baked into an exported OTF/TTF name table for round-trip load. */
export const STUDIO_GENERATOR = 'CompressoParametricStudio';
export const STUDIO_METADATA_VERSION = '1.0';

export interface StudioFontSnapshot {
  generator: typeof STUDIO_GENERATOR;
  version: string;
  presetName: string;
  params: StyleParams;
  customGlyphs: CustomGlyphLibrary;
  ligatures?: LigatureLibrary;
}

/**
 * Resolved render inputs: style params plus the outline paths needed to draw
 * font-symbol modules. Paths are normalized to a unit box, Y-up.
 */
export interface RenderContext {
  params: StyleParams;
  /** character -> SVG path `d` in a 1×1 box centred on the origin, Y-up. */
  fontPaths: Readonly<Record<string, string>>;
  /** Characters available in the currently selected module font. */
  fontAlphabet: string;
  /** Overlay matrices painted in the glyph inspector. */
  customGlyphs: CustomGlyphLibrary;
  /** Ligature substitutions keyed by trigger sequence (e.g. `"FI"`). */
  ligatures: LigatureLibrary;
  /**
   * Stylistic set for text layout: `0` = v1 (default), `1` = v2 / ss01.
   * Inspector canvas ignores this and uses `customGlyphs[ch].active`.
   */
  stylisticSet?: number;
}

/** Canvas geometry for one rendered SVG. */
export interface CanvasBox {
  width: number;
  height: number;
  originX: number;
  originY: number;
}

/** One placed module: absolute column, row and the glyph it belongs to. */
export interface PlacedModule {
  col: number;
  row: number;
  char: string;
  /** Set on serif bars: the module is stretched over these neighbour cells. */
  serif?: SerifReach;
}

export interface TextLayout {
  modules: PlacedModule[];
  maxCol: number;
  minRow: number;
  maxRow: number;
}

export type TabId = 'word' | 'glyph' | 'styles' | 'animation';
