import { memo, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode, type SyntheticEvent } from 'react';
import { Archive, Check, Copy, Download, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { saveAs } from 'file-saver';

import { Button } from '../controls/Button';
import { Modal } from '../Modal';
import { SvgCanvas } from '../SvgCanvas';
import { BUILTIN_PRESET_NAMES, DEFAULT_PHRASE } from '../../data/presets';
import { downloadFont, downloadSvg } from '../../engine/download';
import { FONT_FAMILY, styleSlug } from '../../engine/fontNaming';
import { renderTextSvg } from '../../engine/geometry';
import { generateStyleName, sortPresetNames } from '../../engine/nameGenerator';
import { usePresetContext } from '../../hooks/usePresetContext';
import type { CustomGlyphLibrary, LigatureLibrary, PresetLibrary, StyleParams } from '../../types/fontTypes';
import type { StyleScopedGlyphs, StyleScopedLigatures } from '../../engine/styleAssets';

/** Specimen modules stay white on black for every card state. */
const CARD_SPECIMEN_COLORS = { fill: '#FFFFFF', stroke: '#FFFFFF', background: '#000000' };

interface PresetsGalleryProps {
  presets: PresetLibrary;
  activePreset: string;
  onApply: (name: string) => void;
  onCreate: (
    name: string,
    source?: StyleParams,
    activate?: boolean,
    sourceStyleName?: string,
  ) => string | null;
  onRename: (from: string, to: string) => string | null;
  onDelete: (name: string) => void;
  glyphsByStyle: StyleScopedGlyphs;
  ligaturesByStyle: StyleScopedLigatures;
}

export function PresetsGallery({
  presets,
  activePreset,
  onApply,
  onCreate,
  onRename,
  onDelete,
  glyphsByStyle,
  ligaturesByStyle,
}: PresetsGalleryProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const names = useMemo(() => sortPresetNames(Object.keys(presets), presets), [presets]);
  const activeParams = presets[activePreset];
  const customGlyphs = glyphsByStyle[activePreset] ?? {};
  const ligatures = ligaturesByStyle[activePreset] ?? {};

  const exportContext = usePresetContext(activeParams, customGlyphs, ligatures);

  const handleCopyCard = useCallback(
    (sourceName: string) => {
      const source = presets[sourceName];
      if (!source) {
        return;
      }
      const name = generateStyleName(source, names, presets);
      const error = onCreate(name, source, false, sourceName);
      if (error) {
        setMessage(error);
        return;
      }
      setMessage(`Настройки «${sourceName}» скопированы в «${name}»`);
    },
    [names, onCreate, presets],
  );

  const exportSvg = useCallback(() => {
    if (!exportContext) {
      return;
    }
    const full = renderTextSvg(DEFAULT_PHRASE, exportContext, 1);
    downloadSvg(full, `${styleSlug(activePreset)}-specimen.svg`);
    setMessage('SVG сохранён');
  }, [activePreset, exportContext]);

  const exportFont = useCallback(async () => {
    if (!exportContext) {
      return;
    }
    setBusy(true);
    setMessage('Сборка шрифта…');
    try {
      const { buildFontBinary } = await import('../../engine/opentypeExporter');
      const font = buildFontBinary(exportContext, {
        family: FONT_FAMILY,
        styleName: activePreset,
      });
      downloadFont(font.binary, font.filename);
      setMessage(
        `Шрифт собран: ${font.filename}` +
          (font.kernPairCount > 0 ? ` · кернинг ${font.kernPairCount} пар` : ''),
      );
    } catch (error) {
      setMessage(
        `Ошибка сборки шрифта: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [activePreset, exportContext]);

  const exportFamily = useCallback(async () => {
    setBusy(true);
    setMessage('Сборка архива…');
    try {
      const { FAMILY_PACK_FILENAME, buildFamilyPack } = await import('../../engine/zipExporter');
      const blob = await buildFamilyPack(presets, {
        family: FONT_FAMILY,
        specimen: DEFAULT_PHRASE,
        glyphsByStyle,
        ligaturesByStyle,
        onProgress: (done, total, styleName) => {
          setMessage(`Начертание ${done} из ${total}: ${styleName}`);
        },
      });
      saveAs(blob, FAMILY_PACK_FILENAME);
      setMessage(`Архив собран: ${FAMILY_PACK_FILENAME}`);
    } catch (error) {
      setMessage(
        `Ошибка сборки архива: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [glyphsByStyle, ligaturesByStyle, presets]);

  const confirmDelete = useCallback(() => {
    if (pendingDelete) {
      onDelete(pendingDelete);
      setMessage(`Начертание «${pendingDelete}» удалено`);
      setPendingDelete(null);
    }
  }, [onDelete, pendingDelete]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 bg-black">
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {names.map((name) => (
            <PresetCard
              key={name}
              name={name}
              params={presets[name]}
              specimen={DEFAULT_PHRASE}
              active={name === activePreset}
              deletable={!BUILTIN_PRESET_NAMES.includes(name)}
              onApply={onApply}
              onCopy={handleCopyCard}
              onRename={onRename}
              occupiedNames={names}
              allPresets={presets}
              customGlyphs={glyphsByStyle[name] ?? {}}
              ligatures={ligaturesByStyle[name] ?? {}}
              onRequestDelete={setPendingDelete}
            />
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 rounded-lg border border-neutral-800 bg-black/80 px-3 py-2 backdrop-blur-sm">
        <Button compact onClick={exportSvg} disabled={busy || !exportContext}>
          <Download size={13} aria-hidden />
          Экспорт SVG
        </Button>
        <Button
          compact
          variant="primary"
          onClick={() => void exportFont()}
          disabled={busy || !exportContext}
        >
          <Download size={13} aria-hidden />
          Скачать шрифт (OTF)
        </Button>
        <Button compact onClick={() => void exportFamily()} disabled={busy}>
          <Archive size={13} aria-hidden />
          Скачать семейство (ZIP)
        </Button>
        {message ? (
          <span className="font-mono text-[11px] text-studio-muted">{message}</span>
        ) : null}
      </div>

      {pendingDelete ? (
        <Modal
          title="Удаление начертания"
          onClose={() => setPendingDelete(null)}
          actions={
            <>
              <Button onClick={() => setPendingDelete(null)}>Отмена</Button>
              <Button variant="danger" onClick={confirmDelete}>
                Да, удалить
              </Button>
            </>
          }
        >
          Вы точно хотите удалить начертание «{pendingDelete}»? Это действие нельзя
          отменить.
        </Modal>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */

interface PresetCardProps {
  name: string;
  params: StyleParams;
  specimen: string;
  active: boolean;
  deletable: boolean;
  occupiedNames: readonly string[];
  allPresets: PresetLibrary;
  onApply: (name: string) => void;
  onCopy: (name: string) => void;
  onRename: (from: string, to: string) => string | null;
  onRequestDelete: (name: string) => void;
  customGlyphs: CustomGlyphLibrary;
  ligatures: LigatureLibrary;
}

const PresetCard = memo(function PresetCard({
  name,
  params,
  specimen,
  active,
  deletable,
  occupiedNames,
  allPresets,
  onApply,
  onCopy,
  onRename,
  onRequestDelete,
  customGlyphs,
  ligatures,
}: PresetCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cardParams = useMemo<StyleParams>(
    () => ({
      ...params,
      ...CARD_SPECIMEN_COLORS,
      showGrid: false,
      showGuides: false,
    }),
    [params],
  );

  const context = usePresetContext(cardParams, customGlyphs, ligatures);

  const svg = useMemo(
    () =>
      context
        ? renderTextSvg(specimen, context, 1, { paintBackground: false, contain: true })
        : '',
    [context, specimen],
  );

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const apply = () => {
    if (!renaming) {
      onApply(name);
    }
  };

  const startRename = (event: MouseEvent) => {
    event.stopPropagation();
    setDraft(name);
    setRenameError(null);
    setRenaming(true);
  };

  const suggestName = (event: MouseEvent) => {
    event.stopPropagation();
    const others = occupiedNames.filter((entry) => entry !== name);
    setDraft(generateStyleName(params, others, allPresets));
    setRenameError(null);
  };

  const commitRename = (event?: SyntheticEvent) => {
    event?.stopPropagation();
    const error = onRename(name, draft);
    if (error) {
      setRenameError(error);
      return;
    }
    setRenaming(false);
    setRenameError(null);
  };

  const cancelRename = (event?: SyntheticEvent) => {
    event?.stopPropagation();
    setRenaming(false);
    setDraft(name);
    setRenameError(null);
  };

  const iconBtn = active ? 'primary' : 'default';

  return (
    <article
      className={
        'flex cursor-pointer flex-col gap-2.5 rounded-lg border bg-black p-3 text-left transition-colors ' +
        (active
          ? 'border-2 border-white'
          : 'border-neutral-800 hover:border-neutral-600')
      }
      onClick={apply}
    >
      <div className="flex items-center justify-between gap-2">
        {renaming ? (
          <div
            className="flex min-w-0 flex-1 items-center gap-1"
            onClick={(event) => event.stopPropagation()}
          >
            <input
              ref={inputRef}
              value={draft}
              aria-label="Новое имя начертания"
              className={
                'min-w-0 flex-1 rounded border border-neutral-700 bg-black px-1.5 py-1 text-[12px] text-white outline-none focus:border-white'
              }
              onChange={(event) => {
                setDraft(event.target.value);
                setRenameError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitRename(event);
                } else if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelRename(event);
                }
              }}
            />
            <Button
              compact
              variant={iconBtn}
              title="Рассчитать имя по параметрам"
              onClick={suggestName}
            >
              <Sparkles size={14} aria-hidden />
            </Button>
            <Button compact variant={iconBtn} title="Сохранить имя" onClick={commitRename}>
              <Check size={14} aria-hidden />
            </Button>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-1">
              <h3
                className="truncate text-[13px] font-semibold text-white"
                title={name}
              >
                {name}
              </h3>
              <Button compact variant="ghost" title="Переименовать" onClick={startRename}>
                <Pencil size={13} className="text-studio-muted" aria-hidden />
              </Button>
            </div>
          </>
        )}
      </div>
      {renameError ? (
        <p className="text-[11px] text-[#ff746d]">{renameError}</p>
      ) : null}

      <div className="relative box-border h-[104px] w-full overflow-hidden rounded border border-neutral-800 bg-black p-2">
        {svg ? (
          <SvgCanvas svg={svg} fluid className="absolute inset-0 h-full w-full p-2" />
        ) : (
          <span className="flex h-full items-center justify-center text-[10px] text-studio-faint">
            загрузка контуров…
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center gap-1">
        <CardIconButton title="Скопировать параметры стиля" onClick={() => onCopy(name)}>
          <Copy size={14} aria-hidden />
        </CardIconButton>
        {deletable ? (
          <CardIconButton
            title={`Удалить начертание «${name}»`}
            onClick={() => onRequestDelete(name)}
          >
            <Trash2 size={14} aria-hidden />
          </CardIconButton>
        ) : null}
      </div>
    </article>
  );
});

function CardIconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      className={
        'rounded p-1 text-white opacity-60 transition-opacity hover:opacity-100'
      }
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}
