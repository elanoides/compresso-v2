/**
 * Studio state: the live style, the preset library and the asynchronously
 * loaded font outlines that font-symbol modules need.
 *
 * Glyph matrices and ligatures are stored per начертание. Kerning lives on
 * StyleParams (also per style). Legacy localStorage blobs with a single shared
 * glyph/ligature library are copied onto every style on load.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  DEFAULT_INSPECT_CHAR,
  DEFAULT_PHRASE,
  DEFAULT_PRESET_NAME,
  REGULAR_PARAMS,
  freshPresetLibrary,
  normalizeCustomGlyphs,
  normalizeParams,
} from '../data/presets';
import {
  addGlyphVariant,
  ensureGlyphVariant,
  removeGlyphVariant,
  snapshotGlyph,
  writeActiveGlyph,
} from '../engine/glyphs';
import { uniqueStyleName } from '../engine/nameGenerator';
import { resolveFontPathsFor } from '../engine/renderContext';
import { normalizeLigatureLibrary } from '../engine/ligatures';
import {
  cloneCustomGlyphLibrary,
  cloneLigatureLibrary,
  deleteStyleKey,
  distributeToStyles,
  renameStyleKey,
  type ApplyScope,
  type StyleScopedGlyphs,
  type StyleScopedLigatures,
} from '../engine/styleAssets';
import type {
  CustomGlyph,
  CustomGlyphLibrary,
  Ligature,
  LigatureLibrary,
  RenderContext,
  StyleParams,
  TabId,
} from '../types/fontTypes';

const STORAGE_KEY = 'crt-font-studio/v4';
const LEGACY_STORAGE_KEY = 'crt-font-studio/v3';
const EMPTY_GLYPHS: CustomGlyphLibrary = {};
const EMPTY_LIGATURES: LigatureLibrary = {};

interface PersistedState {
  presets: Record<string, StyleParams>;
  activePreset: string;
  params: StyleParams;
  wordText: string;
  previewScale: number;
  inspectChar: string;
  glyphsByStyle: StyleScopedGlyphs;
  ligaturesByStyle: StyleScopedLigatures;
}

function cloneStyleParams(source: StyleParams): StyleParams {
  return {
    ...source,
    kerningPairs: { ...source.kerningPairs },
    serif: { ...source.serif },
  };
}

function readStorageRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = readStorageRaw();
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed.presets || typeof parsed.presets !== 'object') {
      return null;
    }
    const presets: Record<string, StyleParams> = {};
    for (const [name, params] of Object.entries(parsed.presets as Record<string, unknown>)) {
      presets[name] = normalizeParams(params);
    }
    const merged = { ...freshPresetLibrary(), ...presets };
    const styleNames = Object.keys(merged);
    const activePreset =
      typeof parsed.activePreset === 'string' && merged[parsed.activePreset]
        ? parsed.activePreset
        : DEFAULT_PRESET_NAME;

    const legacyGlyphs = normalizeCustomGlyphs(parsed.customGlyphs);
    const legacyLigatures = normalizeLigatureLibrary(parsed.ligatures);
    const glyphsByStyle = normalizePersistedGlyphMap(
      parsed.glyphsByStyle,
      styleNames,
      legacyGlyphs,
      activePreset,
    );
    const ligaturesByStyle = normalizePersistedLigatureMap(
      parsed.ligaturesByStyle,
      styleNames,
      legacyLigatures,
      activePreset,
    );

    return {
      presets: merged,
      activePreset,
      params: normalizeParams(parsed.params ?? merged[DEFAULT_PRESET_NAME]),
      wordText: typeof parsed.wordText === 'string' ? parsed.wordText : DEFAULT_PHRASE,
      previewScale:
        typeof parsed.previewScale === 'number' && Number.isFinite(parsed.previewScale)
          ? parsed.previewScale
          : 0.38,
      inspectChar:
        typeof parsed.inspectChar === 'string' && parsed.inspectChar
          ? parsed.inspectChar
          : DEFAULT_INSPECT_CHAR,
      glyphsByStyle,
      ligaturesByStyle,
    };
  } catch {
    return null;
  }
}

function normalizePersistedGlyphMap(
  raw: unknown,
  styleNames: readonly string[],
  legacy: CustomGlyphLibrary,
  activePreset: string,
): StyleScopedGlyphs {
  if (raw && typeof raw === 'object') {
    const out: StyleScopedGlyphs = {};
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      out[name] = normalizeCustomGlyphs(value);
    }
    if (Object.keys(out).length > 0) {
      return out;
    }
  }
  if (Object.keys(legacy).length === 0) {
    return {};
  }
  // Legacy saves kept one shared library. Attach it only to the active style so
  // other начертания stay on factory matrices until the user edits them.
  const target =
    activePreset && styleNames.includes(activePreset)
      ? activePreset
      : (styleNames[0] ?? DEFAULT_PRESET_NAME);
  return { [target]: cloneCustomGlyphLibrary(legacy) };
}

function normalizePersistedLigatureMap(
  raw: unknown,
  styleNames: readonly string[],
  legacy: LigatureLibrary,
  activePreset: string,
): StyleScopedLigatures {
  if (raw && typeof raw === 'object') {
    const out: StyleScopedLigatures = {};
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      out[name] = normalizeLigatureLibrary(value);
    }
    if (Object.keys(out).length > 0) {
      return out;
    }
  }
  if (Object.keys(legacy).length === 0) {
    return {};
  }
  const target =
    activePreset && styleNames.includes(activePreset)
      ? activePreset
      : (styleNames[0] ?? DEFAULT_PRESET_NAME);
  return { [target]: cloneLigatureLibrary(legacy) };
}

export interface Studio {
  tab: TabId;
  setTab: (tab: TabId) => void;

  params: StyleParams;
  updateParams: (patch: Partial<StyleParams>) => void;
  setParams: (next: StyleParams) => void;

  presets: Record<string, StyleParams>;
  activePreset: string;
  applyPreset: (name: string) => void;
  saveActivePreset: () => void;
  createPreset: (
    name: string,
    source?: StyleParams,
    activate?: boolean,
    sourceStyleName?: string,
  ) => string | null;
  createDefaultPreset: (name: string) => string | null;
  renamePreset: (from: string, to: string) => string | null;
  deletePreset: (name: string) => void;
  replaceLibrary: (
    presets: Record<string, StyleParams>,
    active: string | null,
    customGlyphs?: CustomGlyphLibrary,
    ligatures?: LigatureLibrary,
    glyphsByStyle?: StyleScopedGlyphs,
    ligaturesByStyle?: StyleScopedLigatures,
  ) => void;
  loadStudioSnapshot: (
    presetName: string,
    source: StyleParams,
    glyphs: CustomGlyphLibrary,
    ligatures?: LigatureLibrary,
  ) => string;
  resetToRegular: () => void;

  wordText: string;
  setWordText: (text: string) => void;
  previewScale: number;
  setPreviewScale: (scale: number) => void;
  inspectChar: string;
  setInspectChar: (ch: string) => void;

  customGlyphs: CustomGlyphLibrary;
  glyphsByStyle: StyleScopedGlyphs;
  setCustomGlyph: (ch: string, glyph: CustomGlyph) => void;
  mergeCustomGlyphs: (patch: Readonly<Record<string, CustomGlyph>>) => void;
  removeCustomGlyph: (ch: string) => void;
  replaceCustomGlyphs: (next: CustomGlyphLibrary) => void;
  addCustomGlyphVariant: (ch: string) => void;
  selectCustomGlyphVariant: (ch: string, index: number) => void;
  removeCustomGlyphVariant: (ch: string, index: number) => void;

  ligatures: LigatureLibrary;
  ligaturesByStyle: StyleScopedLigatures;
  setLigature: (trigger: string, entry: Ligature, scope?: ApplyScope) => void;
  removeLigature: (trigger: string, scope?: ApplyScope) => void;
  replaceLigatures: (next: LigatureLibrary) => void;

  applyKerningPair: (pair: string, delta: number, scope: ApplyScope) => void;
  removeKerningPair: (pair: string, scope: ApplyScope) => void;

  /** Render context for the live style. */
  context: RenderContext;
  fontLoading: boolean;
  fontError: string | null;
}

function ligatureUnchanged(prev: Ligature, next: Ligature): boolean {
  if (prev.trigger !== next.trigger || prev.width !== next.width || prev.coords.length !== next.coords.length) {
    return false;
  }
  return prev.coords.every((coord, index) => {
    const other = next.coords[index];
    return other !== undefined && coord[0] === other[0] && coord[1] === other[1];
  });
}

export function useStudio(): Studio {
  const initial = useMemo(() => loadPersisted(), []);

  const [tab, setTab] = useState<TabId>('word');
  const [presets, setPresetsState] = useState<Record<string, StyleParams>>(
    () => initial?.presets ?? freshPresetLibrary(),
  );
  const [activePreset, setActivePreset] = useState<string>(
    () => initial?.activePreset ?? DEFAULT_PRESET_NAME,
  );
  const [params, setParamsState] = useState<StyleParams>(
    () => initial?.params ?? { ...REGULAR_PARAMS },
  );
  const [wordText, setWordText] = useState(() => initial?.wordText ?? DEFAULT_PHRASE);
  const [previewScale, setPreviewScale] = useState(() => initial?.previewScale ?? 0.38);
  const [inspectChar, setInspectChar] = useState(
    () => initial?.inspectChar ?? DEFAULT_INSPECT_CHAR,
  );
  const [glyphsByStyle, setGlyphsByStyle] = useState<StyleScopedGlyphs>(
    () => initial?.glyphsByStyle ?? {},
  );
  const [ligaturesByStyle, setLigaturesByStyle] = useState<StyleScopedLigatures>(
    () => initial?.ligaturesByStyle ?? {},
  );

  const [fontPaths, setFontPaths] = useState<Readonly<Record<string, string>>>({});
  const [fontAlphabet, setFontAlphabet] = useState('');
  const [fontLoading, setFontLoading] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);

  const activePresetRef = useRef(activePreset);
  activePresetRef.current = activePreset;
  const presetsRef = useRef(presets);
  presetsRef.current = presets;

  const customGlyphs = glyphsByStyle[activePreset] ?? EMPTY_GLYPHS;
  const ligatures = ligaturesByStyle[activePreset] ?? EMPTY_LIGATURES;

  /* ---- persistence -------------------------------------------------- */

  const persistTimer = useRef<number | null>(null);
  useEffect(() => {
    if (persistTimer.current !== null) {
      window.clearTimeout(persistTimer.current);
    }
    persistTimer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            presets,
            activePreset,
            params,
            wordText,
            previewScale,
            inspectChar,
            glyphsByStyle,
            ligaturesByStyle,
            // Active-style mirrors for accidental readers of the legacy shape.
            customGlyphs,
            ligatures,
          }),
        );
      } catch {
        // Quota exceeded or storage disabled — the session still works.
      }
    }, 400);
    return () => {
      if (persistTimer.current !== null) {
        window.clearTimeout(persistTimer.current);
      }
    };
  }, [
    presets,
    activePreset,
    params,
    wordText,
    previewScale,
    inspectChar,
    glyphsByStyle,
    ligaturesByStyle,
    customGlyphs,
    ligatures,
  ]);

  /* ---- font outlines ------------------------------------------------ */

  const fontRequestKey = `${params.moduleType}|${params.moduleFontSubfamily}|${params.moduleFontWeight}|${params.moduleFontChars}`;

  useEffect(() => {
    let cancelled = false;
    setFontError(null);

    if (params.moduleType !== 'font_symbols') {
      setFontPaths({});
      setFontAlphabet('');
      setFontLoading(false);
      return;
    }

    setFontLoading(true);
    resolveFontPathsFor(params)
      .then((resolved) => {
        if (cancelled) {
          return;
        }
        setFontPaths(resolved.paths);
        setFontAlphabet(resolved.alphabet);
        if (!resolved.filename) {
          setFontError('Шрифт для выбранного начертания не найден');
        } else if (Object.keys(resolved.paths).length === 0) {
          setFontError('В выбранном шрифте не найдено подходящих символов');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setFontError(error instanceof Error ? error.message : 'Ошибка загрузки шрифта');
          setFontPaths({});
          setFontAlphabet('');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setFontLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontRequestKey]);

  /* ---- actions ------------------------------------------------------ */

  const updateParams = useCallback((patch: Partial<StyleParams>) => {
    setParamsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setParams = useCallback((next: StyleParams) => {
    setParamsState(next);
  }, []);

  const applyPreset = useCallback((name: string) => {
    setPresetsState((library) => {
      const target = library[name];
      if (target) {
        setParamsState(cloneStyleParams(target));
        setActivePreset(name);
      }
      return library;
    });
  }, []);

  const saveActivePreset = useCallback(() => {
    setPresetsState((library) => ({
      ...library,
      [activePreset]: cloneStyleParams(params),
    }));
  }, [activePreset, params]);

  const createPreset = useCallback(
    (
      rawName: string,
      source?: StyleParams,
      activate = true,
      sourceStyleName?: string,
    ): string | null => {
      const name = rawName.trim();
      if (!name) {
        return 'Введите имя начертания';
      }
      const snapshot = cloneStyleParams(source ?? params);
      const assetSource = sourceStyleName ?? activePresetRef.current;
      let conflict = false;
      setPresetsState((library) => {
        if (library[name]) {
          conflict = true;
          return library;
        }
        return { ...library, [name]: snapshot };
      });
      if (conflict) {
        return `Начертание «${name}» уже существует`;
      }
      setGlyphsByStyle((current) => ({
        ...current,
        [name]: cloneCustomGlyphLibrary(current[assetSource] ?? {}),
      }));
      setLigaturesByStyle((current) => ({
        ...current,
        [name]: cloneLigatureLibrary(current[assetSource] ?? {}),
      }));
      if (activate) {
        setParamsState(snapshot);
        setActivePreset(name);
      }
      return null;
    },
    [params],
  );

  const createDefaultPreset = useCallback(
    (rawName: string): string | null => createPreset(rawName, cloneStyleParams(REGULAR_PARAMS)),
    [createPreset],
  );

  const renamePreset = useCallback((from: string, to: string): string | null => {
    const nextName = to.trim();
    if (!nextName) {
      return 'Введите имя начертания';
    }
    if (nextName === from) {
      return null;
    }
    let error: string | null = null;
    setPresetsState((library) => {
      if (!library[from]) {
        error = `Начертание «${from}» не найдено`;
        return library;
      }
      if (library[nextName]) {
        error = `Начертание «${nextName}» уже существует`;
        return library;
      }
      const next: Record<string, StyleParams> = {};
      for (const key of Object.keys(library)) {
        next[key === from ? nextName : key] = library[key];
      }
      return next;
    });
    if (error) {
      return error;
    }
    setGlyphsByStyle((current) => renameStyleKey(current, from, nextName));
    setLigaturesByStyle((current) => renameStyleKey(current, from, nextName));
    setActivePreset((current) => (current === from ? nextName : current));
    return null;
  }, []);

  const deletePreset = useCallback((name: string) => {
    setPresetsState((library) => {
      if (!library[name]) {
        return library;
      }
      const next = { ...library };
      delete next[name];
      setActivePreset((current) => {
        if (current !== name) {
          return current;
        }
        const fallback = next[DEFAULT_PRESET_NAME] ? DEFAULT_PRESET_NAME : Object.keys(next)[0];
        if (fallback) {
          setParamsState(cloneStyleParams(next[fallback]));
        }
        return fallback ?? DEFAULT_PRESET_NAME;
      });
      return next;
    });
    setGlyphsByStyle((current) => deleteStyleKey(current, name));
    setLigaturesByStyle((current) => deleteStyleKey(current, name));
  }, []);

  const replaceLibrary = useCallback(
    (
      imported: Record<string, StyleParams>,
      active: string | null,
      importedGlyphs?: CustomGlyphLibrary,
      importedLigatures?: LigatureLibrary,
      importedGlyphsByStyle?: StyleScopedGlyphs,
      importedLigaturesByStyle?: StyleScopedLigatures,
    ) => {
      const importedNames = Object.keys(imported);
      setPresetsState((library) => {
        const merged = { ...library, ...imported };
        const target = active && merged[active] ? active : null;
        if (target) {
          setActivePreset(target);
          setParamsState(cloneStyleParams(merged[target]));
        }
        return merged;
      });

      if (importedGlyphsByStyle && Object.keys(importedGlyphsByStyle).length > 0) {
        setGlyphsByStyle((current) => ({ ...current, ...importedGlyphsByStyle }));
      } else if (importedGlyphs && Object.keys(importedGlyphs).length > 0) {
        const distributed = distributeToStyles(
          importedGlyphs,
          importedNames,
          cloneCustomGlyphLibrary,
        );
        setGlyphsByStyle((current) => ({ ...current, ...distributed }));
      }

      if (importedLigaturesByStyle && Object.keys(importedLigaturesByStyle).length > 0) {
        setLigaturesByStyle((current) => ({ ...current, ...importedLigaturesByStyle }));
      } else if (importedLigatures && Object.keys(importedLigatures).length > 0) {
        const distributed = distributeToStyles(
          importedLigatures,
          importedNames,
          cloneLigatureLibrary,
        );
        setLigaturesByStyle((current) => ({ ...current, ...distributed }));
      }
    },
    [],
  );

  const loadStudioSnapshot = useCallback(
    (
      presetName: string,
      source: StyleParams,
      glyphs: CustomGlyphLibrary,
      restoredLigatures: LigatureLibrary = {},
    ): string => {
      const normalized = cloneStyleParams(normalizeParams(source));
      const restoredGlyphs = normalizeCustomGlyphs(glyphs);
      const normalizedLigatures = normalizeLigatureLibrary(restoredLigatures);
      let appliedName = presetName.trim() || 'Imported';
      setPresetsState((library) => {
        appliedName = uniqueStyleName(appliedName, Object.keys(library));
        setParamsState(normalized);
        setActivePreset(appliedName);
        return { ...library, [appliedName]: normalized };
      });
      setGlyphsByStyle((current) => ({
        ...current,
        [appliedName]: restoredGlyphs,
      }));
      setLigaturesByStyle((current) => ({
        ...current,
        [appliedName]: normalizedLigatures,
      }));
      return appliedName;
    },
    [],
  );

  const patchActiveGlyphs = useCallback(
    (updater: (current: CustomGlyphLibrary) => CustomGlyphLibrary) => {
      const styleName = activePresetRef.current;
      setGlyphsByStyle((all) => {
        const current = all[styleName] ?? {};
        const next = updater(current);
        if (next === current) {
          return all;
        }
        return { ...all, [styleName]: next };
      });
    },
    [],
  );

  const setCustomGlyph = useCallback(
    (ch: string, glyph: CustomGlyph) => {
      patchActiveGlyphs((current) => ({
        ...current,
        [ch]: writeActiveGlyph(current[ch], glyph),
      }));
    },
    [patchActiveGlyphs],
  );

  const mergeCustomGlyphs = useCallback(
    (patch: Readonly<Record<string, CustomGlyph>>) => {
      patchActiveGlyphs((current) => {
        const next = { ...current };
        for (const [ch, glyph] of Object.entries(patch)) {
          next[ch] = writeActiveGlyph(current[ch], glyph);
        }
        return next;
      });
    },
    [patchActiveGlyphs],
  );

  const removeCustomGlyph = useCallback(
    (ch: string) => {
      patchActiveGlyphs((current) => {
        if (!(ch in current)) {
          return current;
        }
        const next = { ...current };
        delete next[ch];
        return next;
      });
    },
    [patchActiveGlyphs],
  );

  const replaceCustomGlyphs = useCallback((next: CustomGlyphLibrary) => {
    const styleName = activePresetRef.current;
    setGlyphsByStyle((all) => ({ ...all, [styleName]: next }));
  }, []);

  const addCustomGlyphVariant = useCallback(
    (ch: string) => {
      patchActiveGlyphs((current) => {
        const existing = current[ch];
        const bank = existing ?? {
          active: 0,
          versions: [snapshotGlyph(ch, {})],
        };
        const next = addGlyphVariant(bank);
        if (next === bank) {
          return current;
        }
        return { ...current, [ch]: next };
      });
    },
    [patchActiveGlyphs],
  );

  const selectCustomGlyphVariant = useCallback(
    (ch: string, index: number) => {
      patchActiveGlyphs((current) => {
        if (index <= 0 && !current[ch]) {
          return current;
        }
        const next = ensureGlyphVariant(ch, current[ch], index);
        return { ...current, [ch]: next };
      });
    },
    [patchActiveGlyphs],
  );

  const removeCustomGlyphVariant = useCallback(
    (ch: string, index: number) => {
      patchActiveGlyphs((current) => {
        const bank = current[ch];
        if (!bank) {
          return current;
        }
        const next = removeGlyphVariant(bank, index);
        if (next === bank) {
          return current;
        }
        return { ...current, [ch]: next };
      });
    },
    [patchActiveGlyphs],
  );

  const writeLigatureScoped = useCallback((trigger: string, entry: Ligature, scope: ApplyScope) => {
    if (scope === 'current') {
      const styleName = activePresetRef.current;
      setLigaturesByStyle((all) => {
        const current = all[styleName] ?? {};
        const prev = current[trigger];
        if (prev && ligatureUnchanged(prev, entry)) {
          return all;
        }
        return { ...all, [styleName]: { ...current, [trigger]: entry } };
      });
      return;
    }
    const names = Object.keys(presetsRef.current);
    setLigaturesByStyle((all) => {
      const next = { ...all };
      for (const name of names) {
        const current = next[name] ?? {};
        next[name] = { ...current, [trigger]: entry };
      }
      return next;
    });
  }, []);

  const setLigature = useCallback(
    (trigger: string, entry: Ligature, scope: ApplyScope = 'current') => {
      writeLigatureScoped(trigger, entry, scope);
    },
    [writeLigatureScoped],
  );

  const removeLigature = useCallback((trigger: string, scope: ApplyScope = 'current') => {
    if (scope === 'current') {
      const styleName = activePresetRef.current;
      setLigaturesByStyle((all) => {
        const current = all[styleName];
        if (!current || !(trigger in current)) {
          return all;
        }
        const nextLib = { ...current };
        delete nextLib[trigger];
        return { ...all, [styleName]: nextLib };
      });
      return;
    }
    const names = Object.keys(presetsRef.current);
    setLigaturesByStyle((all) => {
      const next = { ...all };
      for (const name of names) {
        const current = next[name];
        if (!current || !(trigger in current)) {
          continue;
        }
        const nextLib = { ...current };
        delete nextLib[trigger];
        next[name] = nextLib;
      }
      return next;
    });
  }, []);

  const replaceLigatures = useCallback((next: LigatureLibrary) => {
    const styleName = activePresetRef.current;
    setLigaturesByStyle((all) => ({ ...all, [styleName]: next }));
  }, []);

  const applyKerningPair = useCallback((pair: string, delta: number, scope: ApplyScope) => {
    if (scope === 'current') {
      setParamsState((prev) => ({
        ...prev,
        kerningPairs: { ...prev.kerningPairs, [pair]: delta },
      }));
      return;
    }
    setParamsState((prev) => ({
      ...prev,
      kerningPairs: { ...prev.kerningPairs, [pair]: delta },
    }));
    setPresetsState((library) => {
      const next: Record<string, StyleParams> = {};
      for (const [name, style] of Object.entries(library)) {
        next[name] = {
          ...style,
          kerningPairs: { ...style.kerningPairs, [pair]: delta },
        };
      }
      return next;
    });
  }, []);

  const removeKerningPair = useCallback((pair: string, scope: ApplyScope) => {
    if (scope === 'current') {
      setParamsState((prev) => {
        const kerningPairs = { ...prev.kerningPairs };
        delete kerningPairs[pair];
        return { ...prev, kerningPairs };
      });
      return;
    }
    setParamsState((prev) => {
      const kerningPairs = { ...prev.kerningPairs };
      delete kerningPairs[pair];
      return { ...prev, kerningPairs };
    });
    setPresetsState((library) => {
      const next: Record<string, StyleParams> = {};
      for (const [name, style] of Object.entries(library)) {
        const kerningPairs = { ...style.kerningPairs };
        delete kerningPairs[pair];
        next[name] = { ...style, kerningPairs };
      }
      return next;
    });
  }, []);

  const resetToRegular = useCallback(() => {
    setParamsState(cloneStyleParams(REGULAR_PARAMS));
    setPresetsState((library) => ({
      ...library,
      Regular: cloneStyleParams(REGULAR_PARAMS),
    }));
    setActivePreset(DEFAULT_PRESET_NAME);
  }, []);

  const context = useMemo<RenderContext>(
    () => ({ params, fontPaths, fontAlphabet, customGlyphs, ligatures }),
    [params, fontPaths, fontAlphabet, customGlyphs, ligatures],
  );

  return {
    tab,
    setTab,
    params,
    updateParams,
    setParams,
    presets,
    activePreset,
    applyPreset,
    saveActivePreset,
    createPreset,
    createDefaultPreset,
    renamePreset,
    deletePreset,
    replaceLibrary,
    loadStudioSnapshot,
    resetToRegular,
    wordText,
    setWordText,
    previewScale,
    setPreviewScale,
    inspectChar,
    setInspectChar,
    customGlyphs,
    glyphsByStyle,
    setCustomGlyph,
    mergeCustomGlyphs,
    removeCustomGlyph,
    replaceCustomGlyphs,
    addCustomGlyphVariant,
    selectCustomGlyphVariant,
    removeCustomGlyphVariant,
    ligatures,
    ligaturesByStyle,
    setLigature,
    removeLigature,
    replaceLigatures,
    applyKerningPair,
    removeKerningPair,
    context,
    fontLoading,
    fontError,
  };
}
