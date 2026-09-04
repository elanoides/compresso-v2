/**
 * Studio state: the live style, the preset library and the asynchronously
 * loaded font outlines that font-symbol modules need.
 *
 * Everything lives in the browser — the preset library is mirrored into
 * localStorage so a reload keeps the user's work.
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
import type { CustomGlyph, CustomGlyphLibrary, Ligature, LigatureLibrary, RenderContext, StyleParams, TabId } from '../types/fontTypes';

const STORAGE_KEY = 'crt-font-studio/v3';

interface PersistedState {
  presets: Record<string, StyleParams>;
  activePreset: string;
  params: StyleParams;
  wordText: string;
  previewScale: number;
  inspectChar: string;
  customGlyphs: CustomGlyphLibrary;
  ligatures: LigatureLibrary;
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!parsed.presets || typeof parsed.presets !== 'object') {
      return null;
    }
    const presets: Record<string, StyleParams> = {};
    for (const [name, params] of Object.entries(parsed.presets)) {
      presets[name] = normalizeParams(params);
    }
    // Factory styles are always available even if an old payload lacked them.
    const merged = { ...freshPresetLibrary(), ...presets };
    return {
      presets: merged,
      activePreset:
        typeof parsed.activePreset === 'string' && merged[parsed.activePreset]
          ? parsed.activePreset
          : DEFAULT_PRESET_NAME,
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
      customGlyphs: normalizeCustomGlyphs(
        (parsed as { customGlyphs?: unknown }).customGlyphs,
      ),
      ligatures: normalizeLigatureLibrary(
        (parsed as { ligatures?: unknown }).ligatures,
      ),
    };
  } catch {
    return null;
  }
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
  createPreset: (name: string, source?: StyleParams, activate?: boolean) => string | null;
  createDefaultPreset: (name: string) => string | null;
  renamePreset: (from: string, to: string) => string | null;
  deletePreset: (name: string) => void;
  replaceLibrary: (
    presets: Record<string, StyleParams>,
    active: string | null,
    customGlyphs?: CustomGlyphLibrary,
    ligatures?: LigatureLibrary,
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
  setCustomGlyph: (ch: string, glyph: CustomGlyph) => void;
  mergeCustomGlyphs: (patch: Readonly<Record<string, CustomGlyph>>) => void;
  removeCustomGlyph: (ch: string) => void;
  replaceCustomGlyphs: (next: CustomGlyphLibrary) => void;
  addCustomGlyphVariant: (ch: string) => void;
  selectCustomGlyphVariant: (ch: string, index: number) => void;
  removeCustomGlyphVariant: (ch: string, index: number) => void;

  ligatures: LigatureLibrary;
  setLigature: (trigger: string, entry: Ligature) => void;
  removeLigature: (trigger: string) => void;
  replaceLigatures: (next: LigatureLibrary) => void;

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
  const [customGlyphs, setCustomGlyphsState] = useState<CustomGlyphLibrary>(
    () => initial?.customGlyphs ?? {},
  );
  const [ligatures, setLigaturesState] = useState<LigatureLibrary>(
    () => initial?.ligatures ?? {},
  );

  const [fontPaths, setFontPaths] = useState<Readonly<Record<string, string>>>({});
  const [fontAlphabet, setFontAlphabet] = useState('');
  const [fontLoading, setFontLoading] = useState(false);
  const [fontError, setFontError] = useState<string | null>(null);

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
  }, [presets, activePreset, params, wordText, previewScale, inspectChar, customGlyphs, ligatures]);

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
    // Params object identity changes on every slider move; the key captures the
    // only fields that can invalidate the loaded outlines.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontRequestKey]);

  /* ---- actions ------------------------------------------------------ */

  const updateParams = useCallback((patch: Partial<StyleParams>) => {
    setParamsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const setParams = useCallback((next: StyleParams) => {
    setParamsState(next);
  }, []);

  const applyPreset = useCallback(
    (name: string) => {
      setPresetsState((library) => {
        const target = library[name];
        if (target) {
          setParamsState({ ...target });
          setActivePreset(name);
        }
        return library;
      });
    },
    [],
  );

  const saveActivePreset = useCallback(() => {
    setPresetsState((library) => ({ ...library, [activePreset]: { ...params } }));
  }, [activePreset, params]);

  const createPreset = useCallback(
    (rawName: string, source?: StyleParams, activate = true): string | null => {
      const name = rawName.trim();
      if (!name) {
        return 'Введите имя начертания';
      }
      const snapshot = { ...(source ?? params) };
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
      if (activate) {
        setParamsState(snapshot);
        setActivePreset(name);
      }
      return null;
    },
    [params],
  );

  const createDefaultPreset = useCallback(
    (rawName: string): string | null => createPreset(rawName, { ...REGULAR_PARAMS }),
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
          setParamsState({ ...next[fallback] });
        }
        return fallback ?? DEFAULT_PRESET_NAME;
      });
      return next;
    });
  }, []);

  const replaceLibrary = useCallback(
    (
      imported: Record<string, StyleParams>,
      active: string | null,
      importedGlyphs?: CustomGlyphLibrary,
      importedLigatures?: LigatureLibrary,
    ) => {
      setPresetsState((library) => {
        const merged = { ...library, ...imported };
        const target = active && merged[active] ? active : null;
        if (target) {
          setActivePreset(target);
          setParamsState({ ...merged[target] });
        }
        return merged;
      });
      if (importedGlyphs && Object.keys(importedGlyphs).length > 0) {
        setCustomGlyphsState((current) => ({ ...current, ...importedGlyphs }));
      }
      if (importedLigatures && Object.keys(importedLigatures).length > 0) {
        setLigaturesState((current) => ({ ...current, ...importedLigatures }));
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
      const normalized = normalizeParams(source);
      const restoredGlyphs = normalizeCustomGlyphs(glyphs);
      const normalizedLigatures = normalizeLigatureLibrary(restoredLigatures);
      let appliedName = presetName.trim() || 'Imported';
      setPresetsState((library) => {
        appliedName = uniqueStyleName(appliedName, Object.keys(library));
        setParamsState(normalized);
        setActivePreset(appliedName);
        return { ...library, [appliedName]: normalized };
      });
      setCustomGlyphsState(restoredGlyphs);
      setLigaturesState(normalizedLigatures);
      return appliedName;
    },
    [],
  );

  const setCustomGlyph = useCallback((ch: string, glyph: CustomGlyph) => {
    setCustomGlyphsState((current) => ({
      ...current,
      [ch]: writeActiveGlyph(current[ch], glyph),
    }));
  }, []);

  const mergeCustomGlyphs = useCallback((patch: Readonly<Record<string, CustomGlyph>>) => {
    setCustomGlyphsState((current) => {
      const next = { ...current };
      for (const [ch, glyph] of Object.entries(patch)) {
        next[ch] = writeActiveGlyph(current[ch], glyph);
      }
      return next;
    });
  }, []);

  const removeCustomGlyph = useCallback((ch: string) => {
    setCustomGlyphsState((current) => {
      if (!(ch in current)) {
        return current;
      }
      const next = { ...current };
      delete next[ch];
      return next;
    });
  }, []);

  const replaceCustomGlyphs = useCallback((next: CustomGlyphLibrary) => {
    setCustomGlyphsState(next);
  }, []);

  const addCustomGlyphVariant = useCallback((ch: string) => {
    setCustomGlyphsState((current) => {
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
  }, []);

  const selectCustomGlyphVariant = useCallback((ch: string, index: number) => {
    setCustomGlyphsState((current) => {
      if (index <= 0 && !current[ch]) {
        return current;
      }
      const next = ensureGlyphVariant(ch, current[ch], index);
      return { ...current, [ch]: next };
    });
  }, []);

  const removeCustomGlyphVariant = useCallback((ch: string, index: number) => {
    setCustomGlyphsState((current) => {
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
  }, []);

  const setLigature = useCallback((trigger: string, entry: Ligature) => {
    setLigaturesState((current) => {
      const prev = current[trigger];
      if (prev && ligatureUnchanged(prev, entry)) {
        return current;
      }
      return { ...current, [trigger]: entry };
    });
  }, []);

  const removeLigature = useCallback((trigger: string) => {
    setLigaturesState((current) => {
      if (!(trigger in current)) {
        return current;
      }
      const next = { ...current };
      delete next[trigger];
      return next;
    });
  }, []);

  const replaceLigatures = useCallback((next: LigatureLibrary) => {
    setLigaturesState(next);
  }, []);

  const resetToRegular = useCallback(() => {
    setParamsState({ ...REGULAR_PARAMS });
    setPresetsState((library) => ({ ...library, Regular: { ...REGULAR_PARAMS } }));
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
    setCustomGlyph,
    mergeCustomGlyphs,
    removeCustomGlyph,
    replaceCustomGlyphs,
    addCustomGlyphVariant,
    selectCustomGlyphVariant,
    removeCustomGlyphVariant,
    ligatures,
    setLigature,
    removeLigature,
    replaceLigatures,
    context,
    fontLoading,
    fontError,
  };
}
