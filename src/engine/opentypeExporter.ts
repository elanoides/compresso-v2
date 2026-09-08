/**
 * Bake the current style into a real OpenType font.
 *
 * Every module of every glyph is flattened into cubic Bézier contours, so the
 * exported face looks exactly like the on-screen preview — including module
 * rotation, slant, glitch jitter and font-symbol stamps.
 *
 * opentype.js writes a CFF-flavoured sfnt (`OTTO`), which is why the artefact
 * is an `.otf`. Kerning is spliced in afterwards as GPOS plus a legacy `kern`.
 */

import * as opentype from 'opentype.js';

import { MODULE_FONT, type RenderContext, type StyleParams } from '../types/fontTypes';
import { serializeStudioMetadata } from './fontLoader';
import { BASELINE, BODY_TOP, ROWS_TOTAL, fontCharset, getGlyph, glyphWidth } from './glyphs';
import {
  ellipseHalfExtents,
  fontCharMap,
  moduleCenterFontUnits,
  moduleOutlineSegments,
} from './geometry';
import { type KernPair, buildGposKernTable, buildGsubTable, buildLegacyKernTable, injectTables, type LigaRule, type GsubAlternateSet, type GsubSinglePair } from './sfnt';
import {
  ligatureGlyphName,
  ligaturePuaChar,
  ligatureTriggers,
  ligatureWidth,
  tokenCoords,
} from './ligatures';
import { applySlabSerifs, effectiveLetterSpacing } from './serifEngine';
import {
  DEFAULT_STYLE_NAME,
  FONT_FAMILY,
  glyphName,
  postScriptFontName,
  resolveStyleMetrics,
  styleSlug,
} from './fontNaming';
import type { PathSegment } from './svgPath';

const UNITS_PER_EM = 1000;
/** The cap-height band maps to this many font units. */
const CAP_HEIGHT_FONT_UNITS = 750;

function segmentsToOpentypePath(segments: readonly PathSegment[]): opentype.Path {
  const path = new opentype.Path();
  const coord = (value: number): number => Math.round(value * 64) / 64;
  for (const seg of segments) {
    switch (seg.type) {
      case 'M':
        path.moveTo(coord(seg.x), coord(seg.y));
        break;
      case 'L':
        path.lineTo(coord(seg.x), coord(seg.y));
        break;
      case 'C':
        path.curveTo(
          coord(seg.x1),
          coord(seg.y1),
          coord(seg.x2),
          coord(seg.y2),
          coord(seg.x),
          coord(seg.y),
        );
        break;
      case 'Q':
        path.quadTo(coord(seg.x1), coord(seg.y1), coord(seg.x), coord(seg.y));
        break;
      case 'Z':
        path.close();
        break;
    }
  }
  return path;
}

/** Cap-height band to font-unit scale factor for the current spacing. */
export function fontUnitScale(p: StyleParams): number {
  const capSpan = Math.max((BASELINE - BODY_TOP) * p.stepY, 1);
  return CAP_HEIGHT_FONT_UNITS / capSpan;
}

function advanceWidthFor(
  ch: string,
  p: StyleParams,
  scale: number,
  custom: RenderContext['customGlyphs'],
  versionIndex?: number,
): number {
  const cols = glyphWidth(ch, custom, versionIndex) * Math.max(1, p.colScale);
  return Math.max(1, Math.round((cols + effectiveLetterSpacing(p)) * p.stepX * scale));
}

interface BuiltGlyph {
  char: string;
  path: opentype.Path;
  advanceWidth: number;
  yMin: number;
  yMax: number;
}

function buildLigatureOutline(trigger: string, ctx: RenderContext, scale: number): BuiltGlyph {
  const p = ctx.params;
  const baseCoords = tokenCoords(trigger, p.colScale, p.rowScale, ctx.customGlyphs, ctx.ligatures);
  const baseCols = ligatureWidth(trigger, ctx.ligatures) * Math.max(1, p.colScale);
  const { coords, width: advanceCols } = applySlabSerifs(
    trigger,
    baseCoords,
    baseCols,
    p.serif,
    p.colScale,
  );
  const charMap =
    p.moduleType === MODULE_FONT ? fontCharMap(coords, ctx, trigger) : new Map<number, string[]>();

  const segments: PathSegment[] = [];
  const [halfWidth, halfHeight] = ellipseHalfExtents(
    p.rx * scale,
    p.ry * scale,
    p.moduleAngle,
  );

  let yMin = 0;
  let yMax = 0;
  let xMax = 0;

  for (const [col, row] of coords) {
    const [cx, cy] = moduleCenterFontUnits(col, row, p, scale, trigger);
    segments.push(
      ...moduleOutlineSegments(cx, cy, ctx, scale, charMap.get(Math.trunc(col) * 4096 + row)),
    );
    yMin = Math.min(yMin, cy - halfHeight);
    yMax = Math.max(yMax, cy + halfHeight);
    xMax = Math.max(xMax, cx + halfWidth);
  }

  const advanceWidth = Math.max(
    1,
    Math.round((advanceCols + effectiveLetterSpacing(p)) * p.stepX * scale),
    Math.ceil(xMax),
  );

  return {
    char: trigger,
    path: segmentsToOpentypePath(segments),
    advanceWidth,
    yMin: Math.floor(yMin),
    yMax: Math.ceil(yMax),
  };
}

function buildGlyphOutline(
  ch: string,
  ctx: RenderContext,
  scale: number,
  versionIndex = 0,
): BuiltGlyph {
  const p = ctx.params;
  const baseCoords = getGlyph(ch, p.colScale, p.rowScale, ctx.customGlyphs, versionIndex);
  const baseCols = glyphWidth(ch, ctx.customGlyphs, versionIndex) * Math.max(1, p.colScale);
  const { coords, width: advanceCols } = applySlabSerifs(
    ch,
    baseCoords,
    baseCols,
    p.serif,
    p.colScale,
  );
  const charMap =
    p.moduleType === MODULE_FONT ? fontCharMap(coords, ctx, ch) : new Map<number, string[]>();

  const segments: PathSegment[] = [];
  const [halfWidth, halfHeight] = ellipseHalfExtents(
    p.rx * scale,
    p.ry * scale,
    p.moduleAngle,
  );

  let yMin = 0;
  let yMax = 0;
  let xMax = 0;

  for (const [col, row] of coords) {
    const [cx, cy] = moduleCenterFontUnits(col, row, p, scale, ch);
    segments.push(
      ...moduleOutlineSegments(cx, cy, ctx, scale, charMap.get(Math.trunc(col) * 4096 + row)),
    );
    yMin = Math.min(yMin, cy - halfHeight);
    yMax = Math.max(yMax, cy + halfHeight);
    xMax = Math.max(xMax, cx + halfWidth);
  }

  const advanceWidth = Math.max(
    1,
    Math.round((advanceCols + effectiveLetterSpacing(p)) * p.stepX * scale),
    Math.ceil(xMax),
  );

  return {
    char: ch,
    path: segmentsToOpentypePath(segments),
    advanceWidth,
    yMin: Math.floor(yMin),
    yMax: Math.ceil(yMax),
  };
}

function notdefPath(): opentype.Path {
  const path = new opentype.Path();
  path.moveTo(50, 0);
  path.lineTo(50, 700);
  path.lineTo(450, 700);
  path.lineTo(450, 0);
  path.close();
  return path;
}

export interface FontBuildOptions {
  family?: string;
  styleName?: string;
}

export interface BuiltFont {
  binary: ArrayBuffer;
  filename: string;
  styleName: string;
  kernPairCount: number;
}

/** Compile the whole All-Caps alphabet into an OpenType binary. */
export function buildFontBinary(
  ctx: RenderContext,
  options: FontBuildOptions = {},
): BuiltFont {
  const p = ctx.params;
  const family = (options.family ?? FONT_FAMILY).trim() || FONT_FAMILY;
  const styleName = (options.styleName ?? DEFAULT_STYLE_NAME).trim() || DEFAULT_STYLE_NAME;
  const scale = fontUnitScale(p);
  const metrics = resolveStyleMetrics(styleName);

  const glyphs: opentype.Glyph[] = [
    new opentype.Glyph({ name: '.notdef', index: 0, advanceWidth: 500, path: notdefPath() }),
  ];

  // Space carries no ink but must exist so text sets correctly.
  glyphs.push(
    new opentype.Glyph({
      name: 'space',
      unicode: 32,
      unicodes: [32],
      index: 1,
      advanceWidth: advanceWidthFor(' ', p, scale, ctx.customGlyphs),
      path: new opentype.Path(),
    }),
  );

  let outlineMin = 0;
  let outlineMax = 0;
  const glyphIndexByChar = new Map<string, number>();
  const singles: Record<string, GsubSinglePair[]> = {};
  const salt: GsubAlternateSet[] = [];

  for (const ch of fontCharset(ctx.customGlyphs)) {
    const built = buildGlyphOutline(ch, ctx, scale);
    outlineMin = Math.min(outlineMin, built.yMin);
    outlineMax = Math.max(outlineMax, built.yMax);

    const codePoint = ch.codePointAt(0)!;
    const unicodes = [codePoint];
    const lower = ch.toLowerCase();
    if (lower !== ch) {
      unicodes.push(lower.codePointAt(0)!);
    }

    const index = glyphs.length;
    glyphIndexByChar.set(ch, index);
    glyphs.push(
      new opentype.Glyph({
        name: glyphName(ch),
        unicode: codePoint,
        unicodes,
        index,
        advanceWidth: built.advanceWidth,
        path: built.path,
      }),
    );

    const bank = ctx.customGlyphs[ch];
    if (bank && bank.versions.length > 1) {
      const alts: number[] = [];
      for (let version = 1; version < bank.versions.length; version += 1) {
        const alt = buildGlyphOutline(ch, ctx, scale, version);
        outlineMin = Math.min(outlineMin, alt.yMin);
        outlineMax = Math.max(outlineMax, alt.yMax);
        const ssTag = `ss${String(version).padStart(2, '0')}`;
        const altIndex = glyphs.length;
        glyphs.push(
          new opentype.Glyph({
            name: `${glyphName(ch)}.${ssTag}`,
            index: altIndex,
            advanceWidth: alt.advanceWidth,
            path: alt.path,
          }),
        );
        const bucket = singles[ssTag] ?? [];
        bucket.push({ from: index, to: altIndex });
        singles[ssTag] = bucket;
        alts.push(altIndex);
      }
      salt.push({ from: index, alts });
    }
  }

  const ligaRules: LigaRule[] = [];
  const triggers = ligatureTriggers(ctx.ligatures);
  triggers.forEach((trigger, index) => {
    const built = buildLigatureOutline(trigger, ctx, scale);
    outlineMin = Math.min(outlineMin, built.yMin);
    outlineMax = Math.max(outlineMax, built.yMax);

    const pua = ligaturePuaChar(index);
    const codePoint = pua.codePointAt(0)!;
    const ligIndex = glyphs.length;
    glyphs.push(
      new opentype.Glyph({
        name: ligatureGlyphName(trigger),
        unicode: codePoint,
        unicodes: [codePoint],
        index: ligIndex,
        advanceWidth: built.advanceWidth,
        path: built.path,
      }),
    );

    const components = [...trigger]
      .map((ch) => glyphIndexByChar.get(ch))
      .filter((value): value is number => value !== undefined);
    if (components.length === trigger.length) {
      ligaRules.push({ components, ligature: ligIndex });
    }
  });

  const ascender = Math.max(
    Math.ceil(BASELINE * p.stepY * scale + p.ry * scale),
    outlineMax,
    1,
  );
  const descender = Math.min(
    Math.floor((BASELINE - (ROWS_TOTAL - 1)) * p.stepY * scale - p.ry * scale),
    outlineMin,
    -1,
  );

  const studioMetadata = serializeStudioMetadata({
    presetName: styleName,
    params: p,
    customGlyphs: ctx.customGlyphs,
    ligatures: ctx.ligatures,
  });

  const postScriptName = postScriptFontName(family, styleName);
  const fullName = `${family} ${styleName}`;

  const font = new opentype.Font({
    familyName: family,
    styleName,
    unitsPerEm: UNITS_PER_EM,
    ascender,
    descender,
    glyphs,
    weightClass: metrics.weightClass,
    widthClass: metrics.widthClass,
    fsSelection: metrics.fsSelection,
    italicAngle: metrics.italic ? -Math.abs(p.slantAngle || 12) : 0,
    version: 'Version 2.000',
    manufacturer: 'Compresso Parametric Font Studio',
    designer: 'Compresso Parametric Font Studio',
    description: `Generated by Compresso Parametric Font Studio — ${fullName}`,
    license: studioMetadata,
  });
  applyTypographicFamilyNames(font, family, styleName, fullName, postScriptName);

  const kernPairs = resolveKernPairs(p, scale, glyphIndexByChar);
  let binary = font.toArrayBuffer();

  const extras: Array<{ tag: string; data: Uint8Array }> = [];
  const gpos = buildGposKernTable(kernPairs);
  if (gpos) {
    extras.push({ tag: 'GPOS', data: gpos });
  }
  const legacy = buildLegacyKernTable(kernPairs);
  if (legacy) {
    extras.push({ tag: 'kern', data: legacy });
  }
  const gsub = buildGsubTable({
    liga: ligaRules,
    singles,
    salt,
  });
  if (gsub) {
    extras.push({ tag: 'GSUB', data: gsub });
  }
  if (extras.length > 0) {
    binary = injectTables(binary, extras);
  }

  return {
    binary,
    filename: `${styleSlug(family)}-${styleSlug(styleName)}.otf`,
    styleName,
    kernPairCount: kernPairs.length,
  };
}

/** Convert studio kerning (grid columns) into font-unit GPOS adjustments. */
function resolveKernPairs(
  p: StyleParams,
  scale: number,
  glyphIndexByChar: ReadonlyMap<string, number>,
): KernPair[] {
  const out: KernPair[] = [];
  const seen = new Set<string>();

  for (const [pair, delta] of Object.entries(p.kerningPairs)) {
    if ([...pair].length !== 2) {
      continue;
    }
    const [leftChar, rightChar] = [...pair];
    const left = glyphIndexByChar.get(leftChar);
    const right = glyphIndexByChar.get(rightChar);
    if (left === undefined || right === undefined) {
      continue;
    }
    const value = Math.round(delta * p.stepX * scale);
    if (value === 0) {
      continue;
    }
    const key = `${left}/${right}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push({ left, right, value });
  }

  return out;
}

const NAME_PLATFORMS = ['unicode', 'macintosh', 'windows'] as const;

function englishRecord(value: string): { en: string } {
  return { en: value };
}

/**
 * nameID 1/2 + typographic 16/17 so Figma, Adobe and modern OS menus
 * group every style under one family with a subfamily picker.
 */
function applyTypographicFamilyNames(
  font: opentype.Font,
  family: string,
  styleName: string,
  fullName: string,
  postScriptName: string,
): void {
  const names = font.names as Record<string, Record<string, { en: string }>>;
  for (const platform of NAME_PLATFORMS) {
    const table = names[platform];
    if (!table) {
      continue;
    }
    table.fontFamily = englishRecord(family);
    table.fontSubfamily = englishRecord(styleName);
    table.fullName = englishRecord(fullName);
    table.postScriptName = englishRecord(postScriptName);
    table.preferredFamily = englishRecord(family);
    table.preferredSubfamily = englishRecord(styleName);
  }
}
