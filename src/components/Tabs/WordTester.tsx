import { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { Archive, Download } from 'lucide-react';
import { saveAs } from 'file-saver';

import { Button } from '../controls/Button';
import { Checkbox } from '../controls/Inputs';
import { Slider } from '../controls/Slider';
import { SvgCanvas } from '../SvgCanvas';
import { DEFAULT_PHRASE, resolveSpecimen } from '../../data/presets';
import { downloadFont, downloadSvg } from '../../engine/download';
import { FONT_FAMILY, styleSlug } from '../../engine/fontNaming';
import { renderTextSvg } from '../../engine/geometry';
import type { PresetLibrary, RenderContext } from '../../types/fontTypes';

interface WordTesterProps {
  context: RenderContext;
  presets: PresetLibrary;
  activePreset: string;
  text: string;
  onTextChange: (text: string) => void;
  previewScale: number;
  onPreviewScaleChange: (scale: number) => void;
}

export function WordTester({
  context,
  presets,
  activePreset,
  text,
  onTextChange,
  previewScale,
  onPreviewScaleChange,
}: WordTesterProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ss01, setSs01] = useState(false);

  const hasSs01 = useMemo(
    () => Object.values(context.customGlyphs).some((bank) => bank.versions.length > 1),
    [context.customGlyphs],
  );

  const deferredContext = useDeferredValue(context);
  const deferredText = useDeferredValue(text);
  const deferredScale = useDeferredValue(previewScale);
  const previewText = resolveSpecimen(deferredText);
  const fillPct = Math.min(100, Math.max(8, deferredScale * 100));

  const previewContext = useMemo(
    () => ({ ...deferredContext, stylisticSet: ss01 && hasSs01 ? 1 : 0 }),
    [deferredContext, hasSs01, ss01],
  );

  const svg = useMemo(
    () =>
      renderTextSvg(previewText, previewContext, 1, {
        paintBackground: false,
        contain: true,
      }),
    [previewText, previewContext],
  );

  const exportSvg = useCallback(() => {
    const full = renderTextSvg(resolveSpecimen(text), context, 1);
    downloadSvg(full, `${styleSlug(activePreset)}-specimen.svg`);
    setStatus('SVG сохранён');
  }, [activePreset, context, text]);

  const exportFont = useCallback(async () => {
    setBusy(true);
    setStatus('Сборка шрифта…');
    try {
      const { buildFontBinary } = await import('../../engine/opentypeExporter');
      const font = buildFontBinary(context, {
        family: FONT_FAMILY,
        styleName: activePreset,
      });
      downloadFont(font.binary, font.filename);
      setStatus(
        `Шрифт собран: ${font.filename}` +
          (font.kernPairCount > 0 ? ` · кернинг ${font.kernPairCount} пар` : ''),
      );
    } catch (error) {
      setStatus(
        `Ошибка сборки шрифта: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [activePreset, context]);

  const exportFamily = useCallback(async () => {
    setBusy(true);
    setStatus('Сборка архива…');
    try {
      const { FAMILY_PACK_FILENAME, buildFamilyPack } = await import(
        '../../engine/zipExporter'
      );
      const blob = await buildFamilyPack(presets, {
        family: FONT_FAMILY,
        specimen: DEFAULT_PHRASE,
        customGlyphs: context.customGlyphs,
        ligatures: context.ligatures,
        onProgress: (done, total, styleName) => {
          setStatus(`Начертание ${done} из ${total}: ${styleName}`);
        },
      });
      saveAs(blob, FAMILY_PACK_FILENAME);
      setStatus(`Архив собран: ${FAMILY_PACK_FILENAME}`);
    } catch (error) {
      setStatus(
        `Ошибка сборки архива: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [context.customGlyphs, context.ligatures, presets]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-end gap-4">
        <label className="min-w-[240px] flex-1">
          <span className="mb-1 block text-[11px] tracking-wide text-studio-muted">
            Текст (All-Caps)
          </span>
          <input
            type="text"
            value={text}
            onChange={(event) => onTextChange(event.target.value.toUpperCase())}
            placeholder="НОБЕЛЬФАЙК"
            className="w-full rounded border border-studio-border bg-studio-panel px-3 py-2 font-mono text-[15px] tracking-wide text-studio-text outline-none focus:border-studio-border-strong"
            aria-label="Текст для набора"
          />
        </label>
        <div className="w-[220px]">
          <Slider
            label="Размер шрифта"
            value={Math.min(1, previewScale)}
            min={0.1}
            max={1}
            step={0.01}
            onChange={onPreviewScaleChange}
          />
        </div>
        <div className="pb-1">
          <Checkbox
            label="Stylistic Set 01 (v2)"
            checked={ss01 && hasSs01}
            disabled={!hasSs01}
            onChange={(checked) => setSs01(checked)}
          />
        </div>
      </div>

      <div
        className="relative min-h-0 w-full flex-1 overflow-hidden rounded-lg border border-studio-border"
        style={{ backgroundColor: context.params.background }}
      >
        <div
          className="absolute flex items-center justify-center"
          style={{
            width: `${fillPct}%`,
            height: `${fillPct}%`,
            left: `${(100 - fillPct) / 2}%`,
            top: `${(100 - fillPct) / 2}%`,
          }}
        >
          <SvgCanvas svg={svg} fluid className="h-full w-full" />
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button onClick={exportSvg} disabled={busy}>
          <Download size={14} aria-hidden />
          Экспорт SVG
        </Button>
        <Button onClick={() => void exportFont()} disabled={busy} variant="primary">
          <Download size={14} aria-hidden />
          Скачать шрифт (OTF/TTF)
        </Button>
        <Button onClick={() => void exportFamily()} disabled={busy}>
          <Archive size={14} aria-hidden />
          Экспорт семейства (ZIP)
        </Button>
        {status ? (
          <span className="font-mono text-[11px] text-studio-muted">{status}</span>
        ) : null}
      </div>
    </div>
  );
}
