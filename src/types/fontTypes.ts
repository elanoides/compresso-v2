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

/** Historical antiqua classification for contrast and stress. */
export type AntiquaStyle = 'old-style' | 'transitional' | 'modern';

/** Ending form on free stroke terminals (f, r, a, c and stem feet). */
export type AntiquaTerminalType = 'serif' | 'ball' | 'beak';

/**
 * Parametric antiqua (serif) controls for one style.
 * Contrast and stress shape thick/thin strokes; serif metrics build feet and brackets.
 */
export interface AntiquaParams {
  enabled: boolean;
  /** Renaissance (tilted axis), Transitional, or Modern / Didone (vertical axis). */
  style: AntiquaStyle;
  /** Thick-to-thin stroke ratio (1.5–8.0). */
  contrastRatio: number;
  /** Stress / swelling axis in degrees (0° = Didone, ~30–40° = Old Style). */
  stressAngle: number;
  /** Serif length along X relative to stem width. */
  serifLength: number;
  /** Horizontal serif bar thickness relative to stem width. */
  serifThickness: number;
  /** Bracket / apophysis roundness (0 = slab / Didone). */
  bracketRadius: number;
  /** Terminal form on free stroke endings. */
  terminalType: AntiquaTerminalType;
}

export const DEFAULT_ANTIQUA_PARAMS: AntiquaParams = {
  enabled: false,
  style: 'transitional',
  contrastRatio: 3,
  stressAngle: 12,
  serifLength: 1.1,
  serifThickness: 0.35,
  bracketRadius: 0.35,
  terminalType: 'serif',
};

/** Suggested numeric defaults when the user picks an antiqua style. */
export const ANTIQUA_STYLE_PRESETS: Readonly<Record<AntiquaStyle, Partial<AntiquaParams>>> = {
  'old-style': {
    contrastRatio: 2.2,
    stressAngle: 35,
    serifLength: 1.15,
    serifThickness: 0.4,
    bracketRadius: 0.65,
    terminalType: 'serif',
  },
  transitional: {
    contrastRatio: 3.5,
    stressAngle: 12,
    serifLength: 1.05,
    serifThickness: 0.32,
    bracketRadius: 0.3,
    terminalType: 'serif',
  },
  modern: {
    contrastRatio: 6.5,
    stressAngle: 0,
    serifLength: 0.95,
    serifThickness: 0.22,
    bracketRadius: 0,
    terminalType: 'beak',
  },
};

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

  // Antiqua / serif engine
  antiqua: AntiquaParams;

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
  customGlyphs?: Record<string, CustomGlyphBank>;
  ligatures?: Record<string, Ligature>;
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
}

export interface TextLayout {
  modules: PlacedModule[];
  maxCol: number;
  minRow: number;
  maxRow: number;
}

export type TabId = 'word' | 'glyph' | 'styles';
