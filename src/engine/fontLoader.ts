/**
 * Reverse parser for studio round-trip: OpenType name-table snapshots and
 * the existing preset JSON. One reader, one signature.
 */

import * as opentype from 'opentype.js';

import { normalizeCustomGlyphs, normalizeParams, presetsFromJson } from '../data/presets';
import { normalizeLigatureLibrary } from './ligatures';
import {
  STUDIO_GENERATOR,
  STUDIO_METADATA_VERSION,
  type CustomGlyphLibrary,
  type LigatureLibrary,
  type StyleParams,
  type StudioFontSnapshot,
} from '../types/fontTypes';

export { STUDIO_GENERATOR, STUDIO_METADATA_VERSION };

export const FOREIGN_FONT_MESSAGE =
  'Файл не содержит параметрических данных Compresso Studio. Загрузите файл, экспортированный из этого редактора.';

export function studioFontLoadedMessage(name: string): string {
  return `Шрифт "${name}" успешно загружен! Все параметры восстановлены.`;
}

export function serializeStudioMetadata(input: {
  presetName: string;
  params: StyleParams;
  customGlyphs: CustomGlyphLibrary;
  ligatures?: LigatureLibrary;
}): string {
  const payload: StudioFontSnapshot = {
    generator: STUDIO_GENERATOR,
    version: STUDIO_METADATA_VERSION,
    presetName: input.presetName,
    params: input.params,
    customGlyphs: input.customGlyphs,
    ligatures: input.ligatures ?? {},
  };
  return JSON.stringify(payload);
}

export type ParsedStudioFile =
  | {
      kind: 'font';
      presetName: string;
      params: StyleParams;
      customGlyphs: CustomGlyphLibrary;
      ligatures: LigatureLibrary;
    }
  | {
      kind: 'json';
      presets: Record<string, StyleParams>;
      active: string | null;
      customGlyphs: CustomGlyphLibrary;
      ligatures: LigatureLibrary;
    }
  | { kind: 'foreign' };

const NAME_KEYS = ['licenseDescription', 'license', 'description'] as const;

function localizedEn(rec: unknown): string {
  if (typeof rec === 'string' && rec.trim()) {
    return rec;
  }
  if (rec && typeof rec === 'object') {
    const en = (rec as { en?: unknown }).en;
    if (typeof en === 'string' && en.trim()) {
      return en;
    }
  }
  return '';
}

function englishName(font: opentype.Font, key: string): string {
  const fromApi = font.getEnglishName?.(key);
  if (typeof fromApi === 'string' && fromApi.trim()) {
    return fromApi;
  }
  const names = font.names;
  if (!names) {
    return '';
  }
  for (const platform of ['unicode', 'macintosh', 'windows'] as const) {
    const table = names[platform];
    if (table && typeof table === 'object') {
      const text = localizedEn((table as Record<string, unknown>)[key]);
      if (text) {
        return text;
      }
    }
  }
  return localizedEn(names[key]);
}

function parseStudioMetadata(raw: string): StudioFontSnapshot | null {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim());
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const source = data as Record<string, unknown>;
  if (source.generator !== STUDIO_GENERATOR) {
    return null;
  }
  if (!source.params || typeof source.params !== 'object' || Array.isArray(source.params)) {
    return null;
  }
  const presetName =
    typeof source.presetName === 'string' && source.presetName.trim()
      ? source.presetName.trim()
      : 'Imported';
  return {
    generator: STUDIO_GENERATOR,
    version: typeof source.version === 'string' ? source.version : STUDIO_METADATA_VERSION,
    presetName,
    params: normalizeParams(source.params),
    customGlyphs: normalizeCustomGlyphs(source.customGlyphs),
    ligatures: normalizeLigatureLibrary(source.ligatures),
  };
}

function snapshotFromNameTable(font: opentype.Font): StudioFontSnapshot | null {
  for (const key of NAME_KEYS) {
    const raw = englishName(font, key);
    if (!raw) {
      continue;
    }
    const parsed = parseStudioMetadata(raw);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

export function parseStudioFontBuffer(buffer: ArrayBuffer): ParsedStudioFile {
  let font: opentype.Font;
  try {
    font = opentype.parse(buffer);
  } catch (cause) {
    throw new Error(
      cause instanceof Error ? cause.message : 'Не удалось разобрать файл шрифта',
    );
  }
  const snapshot = snapshotFromNameTable(font);
  if (!snapshot) {
    return { kind: 'foreign' };
  }
  return {
    kind: 'font',
    presetName: snapshot.presetName,
    params: snapshot.params,
    customGlyphs: snapshot.customGlyphs,
    ligatures: snapshot.ligatures ?? {},
  };
}

function isJsonFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.json') || file.type === 'application/json';
}

function isFontFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.otf') ||
    name.endsWith('.ttf') ||
    file.type === 'font/otf' ||
    file.type === 'font/ttf' ||
    file.type === 'application/x-font-ttf' ||
    file.type === 'application/font-sfnt'
  );
}

/** Parse a dropped or chosen studio file (.otf / .ttf / preset .json). */
export async function parseStudioFile(file: File): Promise<ParsedStudioFile> {
  if (isJsonFile(file)) {
    const parsed = presetsFromJson(await file.text());
    return {
      kind: 'json',
      presets: parsed.presets,
      active: parsed.active,
      customGlyphs: parsed.customGlyphs,
      ligatures: parsed.ligatures,
    };
  }
  if (isFontFile(file)) {
    return parseStudioFontBuffer(await file.arrayBuffer());
  }
  throw new Error('Поддерживаются файлы .otf, .ttf и .json');
}
