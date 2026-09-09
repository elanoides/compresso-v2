import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  Download,
  Hash,
  Link2,
  Minus,
  Plus,
  RotateCcw,
  Ruler,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';

import { Button } from '../controls/Button';
import { Checkbox, TextField } from '../controls/Inputs';
import { Slider } from '../controls/Slider';
import { Modal } from '../Modal';
import { SvgCanvas } from '../SvgCanvas';
import { downloadSvg, glyphFileName } from '../../engine/download';
import {
  glyphFrame,
  moduleInkExtents,
  renderGlyphSvg,
  transformedCenter,
} from '../../engine/geometry';
import {
  BASELINE,
  MAX_GLYPH_WIDTH,
  MIN_GLYPH_WIDTH,
  MAX_GLYPH_VARIANTS,
  ROWS_TOTAL,
  clipGlyphWidth,
  factoryGlyph,
  foldGlyphKey,
  fontCharset,
  glyphWidth,
  isFactoryChar,
  setGlyphCell,
  snapshotGlyph,
  sortCoords,
} from '../../engine/glyphs';
import {
  CROSSBAR_LETTERS as BAR_LETTERS,
  applyCrossbarOffset,
  crossbarOffset,
  detectCrossbar,
  isCrossbarLetter,
} from '../../engine/crossbar';
import {
  clampLigatureWidth,
  emptyLigatureGlyph,
  ligatureFromGlyph,
  ligatureTriggers,
  ligatureWidth,
  MAX_LIGATURE_WIDTH,
  MIN_LIGATURE_WIDTH,
  normalizeLigatureTrigger,
  snapshotLigature,
  stitchLigatureFromTrigger,
} from '../../engine/ligatures';
import { styleSlug } from '../../engine/fontNaming';
import type { CustomGlyph, CustomGlyphLibrary, Ligature, LigatureLibrary, RenderContext } from '../../types/fontTypes';

type PaintMode = 'fill' | 'clear';

interface GlyphInspectorProps {
  context: RenderContext;
  activePreset: string;
  char: string;
  onCharChange: (char: string) => void;
  customGlyphs: CustomGlyphLibrary;
  ligatures: LigatureLibrary;
  onSetGlyph: (ch: string, glyph: CustomGlyph) => void;
  onRemoveGlyph: (ch: string) => void;
  onMergeGlyphs: (patch: Readonly<Record<string, CustomGlyph>>) => void;
  onAddVariant: (ch: string) => void;
  onSelectVariant: (ch: string, index: number) => void;
  onRemoveVariant: (ch: string, index: number) => void;
  onSetLigature: (trigger: string, entry: Ligature, onDone?: () => void) => void;
  onRemoveLigature: (trigger: string) => void;
  onResetAllGlyphs: () => void;
}

export function GlyphInspector({
  context,
  activePreset,
  char,
  onCharChange,
  customGlyphs,
  ligatures,
  onSetGlyph,
  onRemoveGlyph,
  onMergeGlyphs,
  onAddVariant,
  onSelectVariant,
  onRemoveVariant,
  onSetLigature,
  onRemoveLigature,
  onResetAllGlyphs,
}: GlyphInspectorProps) {
  const [showGrid, setShowGrid] = useState(true);
  const [showGuides, setShowGuides] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [ligOpen, setLigOpen] = useState(false);
  const [ligaturesOpen, setLigaturesOpen] = useState(true);
  const [applyAllBars, setApplyAllBars] = useState(false);
  const [ligDraft, setLigDraft] = useState<CustomGlyph | null>(null);
  const [ligDraftDirty, setLigDraftDirty] = useState(false);

  const savedLigature = ligatures[char];
  const editingLigature = Boolean(savedLigature);
  const ligatureList = useMemo(() => ligatureTriggers(ligatures), [ligatures]);

  useEffect(() => {
    if (!savedLigature) {
      setLigDraft(null);
      setLigDraftDirty(false);
      return;
    }
    setLigDraft({ width: savedLigature.width, coords: savedLigature.coords });
    setLigDraftDirty(false);
  }, [char, savedLigature]);

  const inspectorContext = useMemo<RenderContext>(() => {
    const base: RenderContext = {
      ...context,
      params: { ...context.params, showGrid, showGuides },
    };
    if (editingLigature && ligDraft) {
      return {
        ...base,
        ligatures: { ...base.ligatures, [char]: ligatureFromGlyph(char, ligDraft) },
      };
    }
    return base;
  }, [char, context, editingLigature, ligDraft, showGrid, showGuides]);

  const svg = useMemo(
    () => renderGlyphSvg(char, inspectorContext, { contain: true, ghosts: true }),
    [char, inspectorContext],
  );

  const minWidth = editingLigature ? MIN_LIGATURE_WIDTH : MIN_GLYPH_WIDTH;
  const maxWidth = editingLigature ? MAX_LIGATURE_WIDTH : MAX_GLYPH_WIDTH;
  const baseWidth =
    editingLigature && ligDraft
      ? ligDraft.width
      : editingLigature
        ? ligatureWidth(char, ligatures)
        : glyphWidth(char, customGlyphs);
  const columns = baseWidth * Math.max(1, context.params.colScale);
  const frame = useMemo(() => glyphFrame(char, inspectorContext), [char, inspectorContext]);
  const moduleCount = frame.coords.length + frame.bars.length;
  const currentCoords = useMemo(
    () =>
      editingLigature && ligDraft
        ? ligDraft.coords
        : editingLigature
          ? snapshotLigature(char, ligatures).coords
          : snapshotGlyph(char, customGlyphs).coords,
    [char, customGlyphs, editingLigature, ligDraft, ligatures],
  );
  const bar = useMemo(
    () => detectCrossbar(currentCoords, baseWidth),
    [currentCoords, baseWidth],
  );
  const barShift = useMemo(() => {
    if (!isCrossbarLetter(char) && !bar) {
      return 0;
    }
    return crossbarOffset(currentCoords, factoryGlyph(char), baseWidth);
  }, [char, currentCoords, baseWidth, bar]);

  const bank = editingLigature ? undefined : customGlyphs[char];
  const versionCount = bank?.versions.length ?? 1;
  const activeVersion = bank?.active ?? 0;
  const dirty = editingLigature ? ligDraftDirty : Boolean(bank);
  const charset = useMemo(() => fontCharset(customGlyphs), [customGlyphs]);
  const barRow = bar ? bar.rows[0]! : null;

  const saveLigature = useCallback(() => {
    if (!editingLigature || !ligDraft) {
      return;
    }
    onSetLigature(char, ligatureFromGlyph(char, ligDraft), () => setLigDraftDirty(false));
  }, [char, editingLigature, ligDraft, onSetLigature]);

  const commitGlyph = useCallback(
    (coords: ReturnType<typeof sortCoords>, width = baseWidth) => {
      const clipped = clipGlyphWidth(sortCoords(coords), width);
      if (editingLigature) {
        setLigDraft({ width, coords: clipped });
        setLigDraftDirty(true);
        return;
      }
      onSetGlyph(char, { width, coords: clipped });
    },
    [baseWidth, char, editingLigature, onSetGlyph],
  );

  const download = useCallback(() => {
    const suffix = editingLigature ? char : glyphFileName(char);
    downloadSvg(
      renderGlyphSvg(char, inspectorContext),
      `${styleSlug(activePreset)}-${suffix}.svg`,
    );
  }, [activePreset, char, editingLigature, inspectorContext]);

  const commitCoords = commitGlyph;

  const paintCell = useCallback(
    (displayCol: number, displayRow: number, paintMode: PaintMode) => {
      const colScale = Math.max(1, context.params.colScale);
      const rowScale = Math.max(1, context.params.rowScale);
      const col = Math.floor((displayCol - frame.serifShift) / colScale);
      const row = rowScale <= 1 ? displayRow : Math.min(ROWS_TOTAL - 1, Math.round(displayRow / rowScale));
      if (col < 0 || col >= baseWidth || row < 0 || row >= ROWS_TOTAL) {
        return;
      }
      const snap =
        editingLigature && ligDraft
          ? ligDraft
          : editingLigature
            ? snapshotLigature(char, ligatures)
            : snapshotGlyph(char, customGlyphs);
      const occupied = snap.coords.some(([c, r]) => c === col && r === row);
      const filled = paintMode === 'fill';
      if (filled === occupied) {
        return;
      }
      commitCoords(setGlyphCell(snap.coords, col, row, filled), snap.width);
    },
    [baseWidth, char, commitCoords, context.params.colScale, context.params.rowScale, customGlyphs, editingLigature, frame.serifShift, ligDraft, ligatures],
  );

  const invertGrid = useCallback(() => {
    const snap =
      editingLigature && ligDraft
        ? ligDraft
        : editingLigature
          ? snapshotLigature(char, ligatures)
          : snapshotGlyph(char, customGlyphs);
    const occupied = new Set(snap.coords.map(([c, r]) => `${c}:${r}`));
    const next: Array<[number, number]> = [];
    for (let col = 0; col < snap.width; col += 1) {
      for (let row = 0; row < ROWS_TOTAL; row += 1) {
        if (!occupied.has(`${col}:${row}`)) {
          next.push([col, row]);
        }
      }
    }
    commitCoords(next, snap.width);
  }, [char, commitCoords, customGlyphs, editingLigature, ligDraft, ligatures]);

  const clearGrid = useCallback(() => {
    commitCoords([], baseWidth);
  }, [baseWidth, commitCoords]);

  const resetGlyph = useCallback(() => {
    if (editingLigature) {
      const stitched = stitchLigatureFromTrigger(char, customGlyphs);
      setLigDraft(stitched);
      setLigDraftDirty(true);
      return;
    }
    onRemoveGlyph(char);
    if (!isFactoryChar(char)) {
      onCharChange('А');
    }
  }, [char, customGlyphs, editingLigature, onCharChange, onRemoveGlyph]);

  const deleteCurrent = useCallback(() => {
    if (editingLigature) {
      onRemoveLigature(char);
      onCharChange('А');
      return;
    }
    resetGlyph();
  }, [char, editingLigature, onCharChange, onRemoveLigature, resetGlyph]);

  const setWidth = useCallback(
    (width: number) => {
      const clamped = Math.max(minWidth, Math.min(maxWidth, Math.round(width)));
      const snap =
        editingLigature && ligDraft
          ? ligDraft
          : editingLigature
            ? snapshotLigature(char, ligatures)
            : snapshotGlyph(char, customGlyphs);
      commitCoords(snap.coords, clamped);
    },
    [char, commitCoords, customGlyphs, editingLigature, ligDraft, ligatures, maxWidth, minWidth],
  );

  const requestCharChange = useCallback(
    (nextChar: string) => {
      if (nextChar === char) {
        return;
      }
      if (editingLigature && ligDraftDirty) {
        const ok = window.confirm(
          'Есть несохранённые изменения лигатуры. Переключиться без сохранения?',
        );
        if (!ok) {
          return;
        }
      }
      onCharChange(nextChar);
    },
    [char, editingLigature, ligDraftDirty, onCharChange],
  );

  const shiftLettersTo = useCallback(
    (target: number, letters: readonly string[]) => {
      const patch: Record<string, CustomGlyph> = {};
      for (const letter of letters) {
        const snap = snapshotGlyph(letter, customGlyphs);
        const factory = factoryGlyph(letter);
        const next = applyCrossbarOffset(snap.coords, factory, snap.width, target);
        patch[letter] = { width: snap.width, coords: next };
      }
      if (Object.keys(patch).length > 0) {
        onMergeGlyphs(patch);
      }
    },
    [customGlyphs, onMergeGlyphs],
  );

  const applyBarShift = useCallback(
    (target: number) => {
      if (applyAllBars) {
        shiftLettersTo(target, BAR_LETTERS);
        return;
      }
      if (isCrossbarLetter(char) || bar) {
        shiftLettersTo(target, [char]);
      }
    },
    [applyAllBars, bar, char, shiftLettersTo],
  );

  const setApplyAll = useCallback(
    (checked: boolean) => {
      setApplyAllBars(checked);
      if (checked) {
        shiftLettersTo(barShift, BAR_LETTERS);
      }
    },
    [barShift, shiftLettersTo],
  );

  const barActive = !editingLigature && isCrossbarLetter(char) && Boolean(bar);

  return (
    <div className="flex h-full min-h-0 gap-3">
      <aside className="flex w-[168px] shrink-0 flex-col gap-2">
        <span className="text-[11px] tracking-wide text-studio-muted">
          {editingLigature ? (
            <>
              Лигатура · {char}
              {ligDraftDirty ? (
                <span className="ml-1 text-[#ff746d]">· не сохранено</span>
              ) : null}
            </>
          ) : (
            'Символ'
          )}
        </span>
        <div className="grid min-h-0 flex-1 grid-cols-7 content-start gap-0.5 overflow-y-auto rounded-lg border border-studio-border bg-studio-panel p-1.5">
          {charset.map((candidate) => {
            const selected = candidate === char;
            const custom = candidate in customGlyphs;
            return (
              <button
                key={candidate}
                type="button"
                onClick={() => requestCharChange(candidate)}
                aria-pressed={selected}
                title={custom ? 'Изменённый глиф' : undefined}
                className={
                  'flex aspect-square items-center justify-center rounded-md font-mono text-[11px] transition-colors ' +
                  (selected
                    ? 'bg-white font-bold text-black'
                    : custom
                      ? 'text-studio-text ring-1 ring-studio-border-strong hover:bg-studio-raised'
                      : 'text-studio-muted hover:bg-studio-raised hover:text-studio-text')
                }
              >
                {candidate}
              </button>
            );
          })}
        </div>

        {!editingLigature ? (
          <div className="flex flex-wrap items-center gap-0.5">
            {Array.from({ length: versionCount }, (_, index) => {
              const selected = index === activeVersion;
              return (
                <span key={index} className="inline-flex items-center">
                  <button
                    type="button"
                    aria-pressed={selected}
                    title={index === 0 ? 'Базовая форма (v1)' : `Stylistic Set ${String(index).padStart(2, '0')} (v${index + 1})`}
                    onClick={() => onSelectVariant(char, index)}
                    className={
                      'rounded-md px-1.5 py-0.5 font-mono text-[10px] transition-colors ' +
                      (selected
                        ? 'bg-white font-semibold text-black'
                        : 'border border-studio-border text-studio-muted hover:border-studio-border-strong hover:text-studio-text')
                    }
                  >
                    v{index + 1}
                  </button>
                  {index > 0 ? (
                    <button
                      type="button"
                      title={`Удалить v${index + 1}`}
                      onClick={() => onRemoveVariant(char, index)}
                      className="ml-px flex h-4 w-4 items-center justify-center rounded text-studio-muted hover:bg-studio-raised hover:text-[#ff746d]"
                    >
                      <X size={10} aria-hidden />
                    </button>
                  ) : null}
                </span>
              );
            })}
            {versionCount < MAX_GLYPH_VARIANTS ? (
              <button
                type="button"
                title="Добавить версию (копия v1)"
                onClick={() => onAddVariant(char)}
                className="flex h-5 items-center gap-0.5 rounded-md border border-studio-border px-1 font-mono text-[10px] text-studio-muted hover:border-studio-border-strong hover:text-studio-text"
              >
                <Plus size={11} aria-hidden />
                {versionCount === 1 ? 'v2' : 'версия'}
              </button>
            ) : null}
          </div>
        ) : null}

        <fieldset
          disabled={!barActive}
          className={
            'min-w-0 w-full rounded-lg border border-studio-border bg-studio-surface p-2 ' +
            (barActive ? '' : 'opacity-40')
          }
        >
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-studio-text">
            Перемычка (Crossbar): Y = {barActive ? barRow : '—'}
          </p>
          <Slider
            label="Смещение"
            value={barActive ? barShift : 0}
            min={-5}
            max={5}
            step={1}
            onChange={applyBarShift}
          />
          <div className="mt-1">
            <Checkbox
              label="Применить ко всем буквам (H, A, E, F…)"
              checked={applyAllBars}
              onChange={setApplyAll}
            />
          </div>
          <p className="mt-1 text-[10px] leading-snug text-studio-faint">
            «Ко всем буквам» — только буквы с перемычкой (H, A, E…). Правки
            глифов всегда пишутся лишь в начертание «{activePreset}», не во весь
            шрифт.
          </p>
        </fieldset>

        <div className="flex flex-col gap-1">
          <div className="min-w-0 flex-1">
            <Button compact fullWidth onClick={() => setAddOpen(true)} title="Добавить свой глиф / символ">
              <Plus size={13} aria-hidden />
              Свой символ
            </Button>
          </div>
          <div className="min-w-0 flex-1">
            <Button compact fullWidth onClick={() => setLigOpen(true)} title="Создать лигатуру из 2–4 букв">
              <Link2 size={13} aria-hidden />
              Создать лигатуру
            </Button>
          </div>
        </div>

        <div className="rounded-lg border border-studio-border bg-studio-surface">
          <button
            type="button"
            onClick={() => setLigaturesOpen((open) => !open)}
            className="flex w-full items-center justify-between gap-1 px-2 py-1.5 text-left text-[11px] font-semibold tracking-wide text-studio-text"
          >
            Лигатуры
            <ChevronDown
              size={12}
              aria-hidden
              className={'shrink-0 transition-transform ' + (ligaturesOpen ? 'rotate-180' : '')}
            />
          </button>
          {ligaturesOpen ? (
            <div className="flex flex-wrap gap-1 border-t border-studio-border p-1.5">
              {ligatureList.length === 0 ? (
                <span className="px-1 py-0.5 text-[10px] text-studio-muted">Пока нет лигатур</span>
              ) : (
                ligatureList.map((trigger) => {
                  const selected = trigger === char;
                  return (
                    <span key={trigger} className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => requestCharChange(trigger)}
                        aria-pressed={selected}
                        className={
                          'rounded-md px-1.5 py-0.5 font-mono text-[10px] transition-colors ' +
                          (selected
                            ? 'bg-white font-bold text-black'
                            : 'border border-studio-border text-studio-muted hover:border-studio-border-strong hover:text-studio-text')
                        }
                      >
                        {trigger}
                      </button>
                      <button
                        type="button"
                        title={`Удалить лигатуру ${trigger}`}
                        onClick={() => {
                          onRemoveLigature(trigger);
                          if (char === trigger) {
                            onCharChange('А');
                          }
                        }}
                        className="flex h-4 w-4 items-center justify-center rounded text-studio-muted hover:bg-studio-raised hover:text-[#ff746d]"
                      >
                        <X size={10} aria-hidden />
                      </button>
                    </span>
                  );
                })
              )}
            </div>
          ) : null}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center overflow-hidden">
        <div className="flex h-full min-h-0 w-full max-w-4xl flex-col items-center justify-center gap-2">
          <div className="shrink-0 self-center">
            <ToolHeader
              width={baseWidth}
              minWidth={minWidth}
              maxWidth={maxWidth}
              onWidth={setWidth}
              showGrid={showGrid}
              onShowGrid={setShowGrid}
              showGuides={showGuides}
              onShowGuides={setShowGuides}
              onInvert={invertGrid}
              onClear={clearGrid}
              onReset={resetGlyph}
              resetDisabled={editingLigature ? false : !dirty && isFactoryChar(char)}
              resetTitle={editingLigature ? 'Пересобрать из букв' : 'Сбросить к дефолтной букве'}
              onDelete={deleteCurrent}
              deleteDisabled={editingLigature ? false : isFactoryChar(char)}
              deleteTitle={editingLigature ? 'Удалить лигатуру' : 'Удалить этот глиф из алфавита'}
            />
          </div>

          <div className="relative min-h-0 w-full flex-1 overflow-hidden">
            <div className="m-auto flex h-full w-full items-center justify-center">
              <div className="relative h-full w-full overflow-hidden rounded-lg border border-studio-border bg-black">
                <div className="absolute inset-3 flex items-center justify-center">
                  <SvgCanvas
                    svg={svg}
                    fluid
                    className="pointer-events-none absolute inset-0 m-auto flex h-full w-full items-center justify-center"
                  />
                  <GridPaintLayer
                    frame={frame}
                    context={inspectorContext}
                    char={char}
                    paintCols={columns}
                    onPaint={paintCell}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="flex h-8 shrink-0 items-center justify-center gap-3 self-center">
            {editingLigature ? (
              <Button
                compact
                variant="primary"
                disabled={!ligDraftDirty}
                onClick={saveLigature}
                title="Сохранить лигатуру в библиотеку"
              >
                <Check size={13} aria-hidden />
                Сохранить
              </Button>
            ) : null}
            <Button compact onClick={download} title="Экспорт SVG глифа">
              <Download size={13} aria-hidden />
              Экспорт SVG глифа
            </Button>
            <Button
              compact
              disabled={Object.keys(customGlyphs).length === 0}
              onClick={onResetAllGlyphs}
              title="Убрать все правки инспектора и вернуть заводские матрицы каждой буквы"
            >
              <Undo2 size={13} aria-hidden />
              Очистить все изменения
            </Button>
            <p
              className="ml-auto truncate font-mono text-[11px] tabular-nums"
              style={{ color: '#666' }}
            >
              Модулей: {moduleCount}
              {'  ·  '}
              Колонок: {columns}
              {'  ·  '}
              Baseline: строка {BASELINE}
            </p>
          </div>
        </div>
      </div>

      {addOpen ? (
        <AddGlyphDialog
          existing={charset}
          onClose={() => setAddOpen(false)}
          onCreate={(nextChar, width) => {
            onSetGlyph(nextChar, { width, coords: [] });
            onCharChange(nextChar);
            setAddOpen(false);
          }}
        />
      ) : null}
      {ligOpen ? (
        <AddLigatureDialog
          customGlyphs={customGlyphs}
          existing={ligatureList}
          onClose={() => setLigOpen(false)}
          onCreate={(trigger, glyph) => {
            onSetLigature(trigger, ligatureFromGlyph(trigger, glyph));
            onCharChange(trigger);
            setLigOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ToolHeader({
  width,
  minWidth,
  maxWidth,
  onWidth,
  showGrid,
  onShowGrid,
  showGuides,
  onShowGuides,
  onInvert,
  onClear,
  onReset,
  resetDisabled,
  resetTitle = 'Сбросить к дефолтной букве',
  onDelete,
  deleteDisabled,
  deleteTitle = 'Удалить этот глиф из алфавита',
}: {
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidth: (width: number) => void;
  showGrid: boolean;
  onShowGrid: (value: boolean) => void;
  showGuides: boolean;
  onShowGuides: (value: boolean) => void;
  onInvert: () => void;
  onClear: () => void;
  onReset: () => void;
  resetDisabled: boolean;
  resetTitle?: string;
  onDelete: () => void;
  deleteDisabled: boolean;
  deleteTitle?: string;
}) {
  return (
    <div className="inline-flex h-10 shrink-0 items-center gap-1.5 overflow-x-auto rounded-lg border border-studio-border bg-studio-surface px-2">
      <button
        type="button"
        title="Инвертировать заполнение всех ячеек"
        onClick={onInvert}
        className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-studio-muted transition-colors hover:text-studio-text"
      >
        <ArrowLeftRight size={12} aria-hidden />
        Инвертировать
      </button>

      <span className="mx-0.5 h-5 w-px shrink-0 bg-studio-border-strong" aria-hidden />

      <div className="flex h-7 items-center rounded-md border border-studio-border">
        <button
          type="button"
          title="Меньше колонок"
          disabled={width <= minWidth}
          onClick={() => onWidth(width - 1)}
          className="flex h-full w-7 items-center justify-center text-studio-muted hover:text-studio-text disabled:opacity-30"
        >
          <Minus size={12} aria-hidden />
        </button>
        <span className="min-w-[52px] px-1 text-center font-mono text-[11px] tabular-nums text-studio-text">
          {width} cols
        </span>
        <button
          type="button"
          title="Больше колонок"
          disabled={width >= maxWidth}
          onClick={() => onWidth(width + 1)}
          className="flex h-full w-7 items-center justify-center text-studio-muted hover:text-studio-text disabled:opacity-30"
        >
          <Plus size={12} aria-hidden />
        </button>
      </div>

      <IconToggle pressed={showGrid} onToggle={onShowGrid} label="Сетка" title="Сетка координат">
        <Hash size={12} aria-hidden />
        Сетка
      </IconToggle>
      <IconToggle pressed={showGuides} onToggle={onShowGuides} label="Метрики" title="Метрики">
        <Ruler size={12} aria-hidden />
        Метрики
      </IconToggle>

      <span className="mx-0.5 h-5 w-px shrink-0 bg-studio-border-strong" aria-hidden />

      <button
        type="button"
        title="Очистить сетку"
        onClick={onClear}
        className="flex h-7 w-7 items-center justify-center rounded-md text-studio-muted hover:bg-studio-raised hover:text-studio-text"
      >
        <Trash2 size={14} aria-hidden />
      </button>
      <button
        type="button"
        title={resetTitle}
        disabled={resetDisabled}
        onClick={onReset}
        className="flex h-7 w-7 items-center justify-center rounded-md text-studio-muted hover:bg-studio-raised hover:text-studio-text disabled:cursor-not-allowed disabled:opacity-30"
      >
        <RotateCcw size={14} aria-hidden />
      </button>
      <button
        type="button"
        title={deleteTitle}
        disabled={deleteDisabled}
        onClick={onDelete}
        className="flex h-7 w-7 items-center justify-center rounded-md text-studio-muted hover:bg-studio-raised hover:text-studio-text disabled:cursor-not-allowed disabled:opacity-30"
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}

function IconToggle({
  pressed,
  onToggle,
  label,
  title,
  children,
}: {
  pressed: boolean;
  onToggle: (value: boolean) => void;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={pressed}
      aria-label={label}
      title={title}
      onClick={() => onToggle(!pressed)}
      className={
        'flex h-7 items-center gap-1 rounded-md px-2 text-[11px] transition-colors ' +
        (pressed
          ? 'bg-studio-raised text-white'
          : 'text-studio-muted hover:text-studio-text')
      }
    >
      {children}
    </button>
  );
}

interface GridPaintLayerProps {
  frame: ReturnType<typeof glyphFrame>;
  context: RenderContext;
  char: string;
  paintCols: number;
  onPaint: (col: number, row: number, paintMode: PaintMode) => void;
}

function GridPaintLayer({
  frame,
  context,
  char,
  paintCols,
  onPaint,
}: GridPaintLayerProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const painting = useRef(false);
  const paintMode = useRef<PaintMode | null>(null);
  const visited = useRef(new Set<string>());
  const [hover, setHover] = useState<{ col: number; row: number } | null>(null);

  const occupied = useMemo(() => {
    const keys = new Set<string>();
    for (const [col, row] of frame.baseCoords) {
      keys.add(`${col}:${row}`);
    }
    return keys;
  }, [frame.baseCoords]);

  const hitCell = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>): { col: number; row: number } | null => {
      const svg = svgRef.current;
      if (!svg) {
        return null;
      }
      const ctm = svg.getScreenCTM();
      if (!ctm) {
        return null;
      }
      const pt = svg.createSVGPoint();
      pt.x = event.clientX;
      pt.y = event.clientY;
      const loc = pt.matrixTransform(ctm.inverse());
      const p = context.params;
      const [hw, hh] = moduleInkExtents(p);
      let best: { col: number; row: number; dist: number } | null = null;
      for (let row = frame.minRow; row <= frame.maxRow; row += 1) {
        for (let col = frame.serifShift; col < frame.serifShift + paintCols; col += 1) {
          const [cx, cy] = transformedCenter(
            col,
            row,
            p,
            frame.box.originX,
            frame.box.originY,
            frame.minRow,
            char,
          );
          const dx = loc.x - cx;
          const dy = loc.y - cy;
          if (Math.abs(dx) <= Math.max(hw, p.stepX / 2) && Math.abs(dy) <= Math.max(hh, p.stepY / 2)) {
            const dist = dx * dx + dy * dy;
            if (!best || dist < best.dist) {
              best = { col, row, dist };
            }
          }
        }
      }
      return best;
    },
    [char, context.params, frame, paintCols],
  );

  const apply = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>, start: boolean) => {
      const cell = hitCell(event);
      setHover(cell);
      if (!cell) {
        return;
      }
      const key = `${cell.col}:${cell.row}`;
      if (visited.current.has(key)) {
        return;
      }
      visited.current.add(key);
      if (start) {
        const filled = occupied.has(key);
        paintMode.current = filled ? 'clear' : 'fill';
      }
      if (!paintMode.current) {
        return;
      }
      onPaint(cell.col, cell.row, paintMode.current);
    },
    [hitCell, occupied, onPaint],
  );

  const hoverCenter = hover
    ? transformedCenter(
        hover.col,
        hover.row,
        context.params,
        frame.box.originX,
        frame.box.originY,
        frame.minRow,
        char,
      )
    : null;
  const hoverEmpty = Boolean(hover && hoverCenter && !occupied.has(`${hover.col}:${hover.row}`));
  const hoverFilled = Boolean(hover && hoverCenter && occupied.has(`${hover.col}:${hover.row}`));
  const angle = context.params.moduleAngle;

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      width="100%"
      height="100%"
      viewBox={`0 0 ${frame.box.width.toFixed(1)} ${frame.box.height.toFixed(1)}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 m-auto h-full w-full cursor-crosshair"
      style={{ touchAction: 'none' }}
      onPointerDown={(event) => {
        event.preventDefault();
        painting.current = true;
        paintMode.current = null;
        visited.current = new Set();
        event.currentTarget.setPointerCapture(event.pointerId);
        apply(event, true);
      }}
      onPointerMove={(event) => {
        if (painting.current) {
          apply(event, false);
          return;
        }
        setHover(hitCell(event));
      }}
      onPointerLeave={() => {
        if (!painting.current) {
          setHover(null);
        }
      }}
      onPointerUp={(event) => {
        painting.current = false;
        paintMode.current = null;
        visited.current.clear();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        painting.current = false;
        paintMode.current = null;
        visited.current.clear();
        setHover(null);
      }}
    >
      <rect width="100%" height="100%" fill="transparent" />
      {(hoverEmpty || hoverFilled) && hoverCenter ? (
        <ellipse
          cx={hoverCenter[0]}
          cy={hoverCenter[1]}
          rx={context.params.rx}
          ry={context.params.ry}
          fill={hoverEmpty ? 'none' : context.params.fill}
          fillOpacity={hoverFilled ? 0.25 : undefined}
          stroke={context.params.fill}
          strokeOpacity={0.8}
          strokeWidth={1.25}
          transform={
            Math.abs(angle) >= 1e-9
              ? `rotate(${angle.toFixed(2)} ${hoverCenter[0].toFixed(2)} ${hoverCenter[1].toFixed(2)})`
              : undefined
          }
          pointerEvents="none"
        />
      ) : null}
    </svg>
  );
}

function AddGlyphDialog({
  existing,
  onClose,
  onCreate,
}: {
  existing: readonly string[];
  onClose: () => void;
  onCreate: (ch: string, width: number) => void;
}) {
  const [raw, setRaw] = useState('');
  const [width, setWidth] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const occupied = useMemo(() => new Set(existing), [existing]);

  const submit = () => {
    const chars = [...raw.trim()];
    if (chars.length === 0) {
      setError('Укажите символ или Unicode');
      return;
    }
    const ch = foldGlyphKey(chars[0]!);
    if (!ch || ch === ' ') {
      setError('Пробел нельзя назначить глифом');
      return;
    }
    onCreate(ch, width);
  };

  return (
    <Modal
      title="Добавить свой глиф"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={submit}>
            Создать пустую сетку
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          label="Символ (клавиша или Unicode)"
          value={raw}
          placeholder="Например @ или Ф"
          onChange={(value) => {
            setRaw(value.slice(-2));
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
        {raw.trim() && occupied.has(foldGlyphKey([...raw.trim()][0] ?? '')) ? (
          <p className="text-[11px] text-studio-muted">
            Символ уже есть в алфавите — сетка будет очищена и привязана заново.
          </p>
        ) : null}
        <Slider
          label="Ширина сетки"
          value={width}
          min={MIN_GLYPH_WIDTH}
          max={MAX_GLYPH_WIDTH}
          step={1}
          onChange={setWidth}
        />
        {error ? <p className="text-[11px] text-[#ff746d]">{error}</p> : null}
      </div>
    </Modal>
  );
}

function AddLigatureDialog({
  customGlyphs,
  existing,
  onClose,
  onCreate,
}: {
  customGlyphs: CustomGlyphLibrary;
  existing: readonly string[];
  onClose: () => void;
  onCreate: (trigger: string, glyph: CustomGlyph) => void;
}) {
  const [raw, setRaw] = useState('');
  const [stitch, setStitch] = useState(true);
  const [width, setWidth] = useState(MIN_LIGATURE_WIDTH);
  const [error, setError] = useState<string | null>(null);
  const occupied = useMemo(() => new Set(existing), [existing]);

  const submit = () => {
    const trigger = normalizeLigatureTrigger(raw, customGlyphs);
    if (!trigger) {
      setError('Укажите 2–4 заглавные буквы из алфавита');
      return;
    }
    if (occupied.has(trigger)) {
      setError(`Лигатура «${trigger}» уже существует`);
      return;
    }
    const glyph = stitch
      ? stitchLigatureFromTrigger(trigger, customGlyphs)
      : emptyLigatureGlyph(clampLigatureWidth(width));
    onCreate(trigger, glyph);
  };

  return (
    <Modal
      title="Создать лигатуру"
      onClose={onClose}
      actions={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={submit}>
            Создать и открыть
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField
          label="Триггер (2–4 буквы, All-Caps)"
          value={raw}
          placeholder="Например FI или SCH"
          onChange={(value) => {
            setRaw(value.toUpperCase().slice(0, 4));
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Checkbox
          label="Собрать из матриц букв (stitch)"
          checked={stitch}
          onChange={setStitch}
        />
        {!stitch ? (
          <Slider
            label="Ширина сетки"
            value={width}
            min={MIN_LIGATURE_WIDTH}
            max={MAX_LIGATURE_WIDTH}
            step={1}
            onChange={setWidth}
          />
        ) : (
          <p className="text-[11px] text-studio-muted">
            Ширина рассчитается автоматически по сумме ширин букв (8–16 колонок).
          </p>
        )}
        {error ? <p className="text-[11px] text-[#ff746d]">{error}</p> : null}
      </div>
    </Modal>
  );
}
