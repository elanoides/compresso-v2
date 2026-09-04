/**
 * Family pack: a flat ZIP of one OpenType file per style.
 * Studio metadata already lives inside each OTF name table.
 */

import JSZip from 'jszip';

import type { CustomGlyphLibrary, LigatureLibrary, PresetLibrary, RenderContext, StyleParams } from '../types/fontTypes';
import { styleSlug } from './fontNaming';
import { buildFontBinary } from './opentypeExporter';
import { resolveFontPathsFor } from './renderContext';

export const FAMILY_PACK_FILENAME = 'Compresso_Parametric_Family_Pack.zip';

export interface FamilyPackOptions {
  family: string;
  specimen: string;
  customGlyphs?: CustomGlyphLibrary;
  ligatures?: LigatureLibrary;
  /** Called after each style so the UI can show progress. */
  onProgress?: (done: number, total: number, styleName: string) => void;
}

/**
 * Build the family archive. Font outlines are resolved per style, so a style
 * using font-symbol modules pulls in exactly the face it needs.
 */
export async function buildFamilyPack(
  presets: PresetLibrary,
  options: FamilyPackOptions,
): Promise<Blob> {
  const zip = new JSZip();
  const entries = Object.entries(presets);
  const total = entries.length;
  const customGlyphs = options.customGlyphs ?? {};
  const ligatures = options.ligatures ?? {};
  const usedNames = new Set<string>();

  let done = 0;
  for (const [styleName, params] of entries) {
    const ctx = await buildStyleContext(params, customGlyphs, ligatures);
    const fileName = uniquePackFileName(options.family, styleName, usedNames);
    usedNames.add(fileName);

    try {
      const font = buildFontBinary(ctx, { family: options.family, styleName });
      zip.file(fileName, font.binary);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Не удалось собрать «${styleName}»: ${message}`);
    }

    done += 1;
    options.onProgress?.(done, total, styleName);
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
}

/** `Compresso-Expanded-Light-600.otf` — family first word + preset slug. */
export function familyPackFileName(family: string, styleName: string): string {
  const familyToken = styleSlug(family.trim().split(/\s+/)[0] ?? family);
  return `${familyToken}-${styleSlug(styleName)}.otf`;
}

function uniquePackFileName(
  family: string,
  styleName: string,
  taken: ReadonlySet<string>,
): string {
  const base = familyPackFileName(family, styleName);
  if (!taken.has(base)) {
    return base;
  }
  const stem = base.replace(/\.otf$/i, '');
  let n = 2;
  let candidate = `${stem}-${n}.otf`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${stem}-${n}.otf`;
  }
  return candidate;
}

async function buildStyleContext(
  params: StyleParams,
  customGlyphs: CustomGlyphLibrary,
  ligatures: LigatureLibrary = {},
): Promise<RenderContext> {
  const resolved = await resolveFontPathsFor(params);
  return {
    params,
    fontPaths: resolved.paths,
    fontAlphabet: resolved.alphabet,
    customGlyphs,
    ligatures,
  };
}
