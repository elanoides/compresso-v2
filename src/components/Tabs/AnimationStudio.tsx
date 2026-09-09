import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Download, Pause, Play, Plus, Trash2 } from 'lucide-react';

import { Button } from '../controls/Button';
import { Combobox, RadioGroup } from '../controls/Inputs';
import { Slider } from '../controls/Slider';
import { Modal } from '../Modal';
import { SvgCanvas } from '../SvgCanvas';
import { DEFAULT_PRESET_NAME, resolveSpecimen } from '../../data/presets';
import {
  EASING_LABELS,
  applyEasing,
  interpolateStyleParams,
  keyframeFromParams,
  newTimelineKeyframeId,
  occupancyForText,
  sampleTimeline,
  type EasingFunction,
  type TimelineKeyframe,
} from '../../engine/animationEngine';
import { downloadBlob } from '../../engine/download';
import { nextOrdinalStyleName, sortPresetNames } from '../../engine/nameGenerator';
import { renderTextSvg } from '../../engine/geometry';
import { BASELINE, ROWS_TOTAL } from '../../engine/glyphs';
import {
  generateWebEmbedCode,
  type EmbedMode,
} from '../../engine/webEmbedExporter';
import type {
  CustomGlyphLibrary,
  LigatureLibrary,
  PresetLibrary,
  RenderContext,
  StyleParams,
} from '../../types/fontTypes';
import type { StyleScopedGlyphs, StyleScopedLigatures } from '../../engine/styleAssets';

interface AnimationStudioProps {
  presets: PresetLibrary;
  activePreset: string;
  text: string;
  onTextChange: (text: string) => void;
  glyphsByStyle: StyleScopedGlyphs;
  ligaturesByStyle: StyleScopedLigatures;
  fontPaths: Readonly<Record<string, string>>;
  fontAlphabet: string;
  /** Create a new style. Return an error string, or null on success. */
  onCreatePreset: (name: string, sourceStyleName?: string) => string | null;
}

function assetsFor(
  name: string,
  glyphsByStyle: StyleScopedGlyphs,
  ligaturesByStyle: StyleScopedLigatures,
): { glyphs: CustomGlyphLibrary; ligatures: LigatureLibrary } {
  return {
    glyphs: glyphsByStyle[name] ?? {},
    ligatures: ligaturesByStyle[name] ?? {},
  };
}

function parseViewBox(svg: string): { width: number; height: number } {
  const match = /viewBox="0 0 ([0-9.]+) ([0-9.]+)"/.exec(svg);
  if (!match) {
    return { width: 1920, height: 540 };
  }
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function paintSvgOnCanvas(svg: string, canvas: HTMLCanvasElement, background: string): Promise<void> {
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Не удалось растеризовать кадр'));
      image.src = url;
    });
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('2D-контекст недоступен');
    }
    ctx.fillStyle = background || '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function initialKeyframes(activePreset: string, names: readonly string[]): TimelineKeyframe[] {
  const first = activePreset && names.includes(activePreset) ? activePreset : names[0] ?? DEFAULT_PRESET_NAME;
  const second = names.find((name) => name !== first) ?? first;
  return [
    { id: newTimelineKeyframeId(), presetName: first },
    { id: newTimelineKeyframeId(), presetName: second },
  ];
}

export function AnimationStudio({
  presets,
  activePreset,
  text,
  onTextChange,
  glyphsByStyle,
  ligaturesByStyle,
  fontPaths,
  fontAlphabet,
  onCreatePreset,
}: AnimationStudioProps) {
  const names = useMemo(() => sortPresetNames(Object.keys(presets), presets), [presets]);
  const [keyframes, setKeyframes] = useState<TimelineKeyframe[]>(() =>
    initialKeyframes(activePreset, names),
  );
  const [playing, setPlaying] = useState(false);
  const [mix, setMix] = useState(0);
  const [durationSec, setDurationSec] = useState(3);
  const [easing, setEasing] = useState<EasingFunction>('pingPong');
  const [exportProgress, setExportProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [embedOpen, setEmbedOpen] = useState(false);
  const [embedMode, setEmbedMode] = useState<EmbedMode>('loop');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setKeyframes((current) => {
      let changed = false;
      const fallback = names[0] ?? DEFAULT_PRESET_NAME;
      const next = current.map((frame) => {
        if (names.includes(frame.presetName)) {
          return frame;
        }
        changed = true;
        return { ...frame, presetName: fallback };
      });
      return changed ? next : current;
    });
  }, [names]);

  const displayT = playing ? applyEasing(mix, easing) : mix;
  const sample = useMemo(() => sampleTimeline(keyframes, displayT), [displayT, keyframes]);

  const paramsFrom = sample
    ? (presets[sample.fromName] ?? presets[names[0]!]!)
    : presets[names[0]!]!;
  const paramsTo = sample
    ? (presets[sample.toName] ?? presets[names[0]!]!)
    : presets[names[0]!]!;
  const localT = sample?.localT ?? 0;

  // Glyph variants, ligatures and kerning stay on the first keyframe — they do not morph.
  const glyphAnchorName = keyframes[0]?.presetName ?? names[0] ?? DEFAULT_PRESET_NAME;
  const anchorParams = presets[glyphAnchorName] ?? paramsFrom;

  const morphParams = useMemo(() => {
    const blended = interpolateStyleParams(paramsFrom, paramsTo, localT);
    return { ...blended, kerningPairs: anchorParams.kerningPairs };
  }, [anchorParams.kerningPairs, localT, paramsFrom, paramsTo]);
  const morphAssets = assetsFor(glyphAnchorName, glyphsByStyle, ligaturesByStyle);

  const previewContext = useMemo<RenderContext>(
    () => ({
      params: { ...morphParams, showGrid: false, showGuides: false },
      fontPaths,
      fontAlphabet,
      customGlyphs: morphAssets.glyphs,
      ligatures: morphAssets.ligatures,
    }),
    [fontAlphabet, fontPaths, morphAssets.glyphs, morphAssets.ligatures, morphParams],
  );

  const specimen = resolveSpecimen(text);

  /**
   * Locked animation frame from max Grid step X/Y across keyframes.
   * Baseline Y is fixed — stepY then changes letter height on screen.
   */
  const lockedFrame = useMemo(() => {
    const anchorAssets = assetsFor(glyphAnchorName, glyphsByStyle, ligaturesByStyle);
    let maxStepY = 1;
    let maxRy = 1;
    let maxContentWidth = 0;
    for (const frame of keyframes) {
      const params = presets[frame.presetName];
      if (!params) {
        continue;
      }
      maxStepY = Math.max(maxStepY, params.stepY);
      maxRy = Math.max(maxRy, params.ry);
      const ctx: RenderContext = {
        params: {
          ...params,
          showGrid: false,
          showGuides: false,
          kerningPairs: anchorParams.kerningPairs,
        },
        fontPaths,
        fontAlphabet,
        customGlyphs: anchorAssets.glyphs,
        ligatures: anchorAssets.ligatures,
      };
      const measured = renderTextSvg(specimen, ctx, 1, {
        paintBackground: false,
        contain: false,
      });
      const box = parseViewBox(measured);
      maxContentWidth = Math.max(maxContentWidth, box.width);
    }
    const pad = 40;
    const height = pad * 2 + (ROWS_TOTAL - 1) * maxStepY + maxRy * 2;
    const baselineY = pad + maxRy + BASELINE * maxStepY;
    return {
      width: Math.max(maxContentWidth, 1),
      height: Math.max(height, 1),
      baselineY,
    };
  }, [
    anchorParams.kerningPairs,
    fontAlphabet,
    fontPaths,
    glyphAnchorName,
    glyphsByStyle,
    keyframes,
    ligaturesByStyle,
    presets,
    specimen,
  ]);

  const svg = useMemo(
    () =>
      renderTextSvg(specimen, previewContext, 1, {
        paintBackground: true,
        contain: true,
        lockedFrame,
      }),
    [lockedFrame, previewContext, specimen],
  );

  useEffect(() => {
    if (!playing) {
      return undefined;
    }
    let raf = 0;
    const started = performance.now() - mix * durationSec * 1000;
    const tick = (now: number) => {
      const elapsed = (now - started) / 1000;
      const linear = durationSec <= 0 ? 0 : (elapsed / durationSec) % 1;
      setMix(linear);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationSec, playing]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      event.preventDefault();
      setPlaying((current) => !current);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const togglePlay = useCallback(() => {
    setPlaying((current) => !current);
  }, []);

  const setKeyframePreset = useCallback((id: string, presetName: string) => {
    setKeyframes((current) =>
      current.map((frame) => (frame.id === id ? { ...frame, presetName } : frame)),
    );
  }, []);

  const createKeyframePreset = useCallback(
    (id: string, name: string, sourceStyleName: string): string | null => {
      const error = onCreatePreset(name, sourceStyleName);
      if (error) {
        return error;
      }
      setKeyframePreset(id, name);
      setStatus(`Создано начертание «${name}»`);
      return null;
    },
    [onCreatePreset, setKeyframePreset],
  );

  const addKeyframe = useCallback(() => {
    const last = keyframes[keyframes.length - 1];
    const nextName =
      names.find((name) => name !== last?.presetName) ??
      last?.presetName ??
      names[0] ??
      DEFAULT_PRESET_NAME;
    setKeyframes((current) => [
      ...current,
      { id: newTimelineKeyframeId(), presetName: nextName },
    ]);
  }, [keyframes, names]);

  const removeKeyframe = useCallback((id: string) => {
    setKeyframes((current) => {
      if (current.length <= 2) {
        return current;
      }
      return current.filter((frame) => frame.id !== id);
    });
  }, []);

  const resolveAt = useCallback(
    (t: number): { params: StyleParams; styleName: string } => {
      const eased = applyEasing(t, easing);
      const point = sampleTimeline(keyframes, eased);
      const fallbackName = names[0] ?? DEFAULT_PRESET_NAME;
      const glyphAnchor = keyframes[0]?.presetName ?? fallbackName;
      if (!point) {
        return { params: presets[fallbackName]!, styleName: glyphAnchor };
      }
      const from = presets[point.fromName] ?? presets[fallbackName]!;
      const to = presets[point.toName] ?? presets[fallbackName]!;
      const anchor = presets[glyphAnchor] ?? from;
      return {
        params: {
          ...interpolateStyleParams(from, to, point.localT),
          kerningPairs: anchor.kerningPairs,
        },
        styleName: glyphAnchor,
      };
    },
    [easing, keyframes, names, presets],
  );

  const renderExportFrame = useCallback(
    async (t: number) => {
      const canvas = canvasRef.current;
      if (!canvas) {
        throw new Error('Холст записи не готов');
      }
      // videoExporter already applies easing — sample the raw playhead here.
      const point = sampleTimeline(keyframes, t);
      const fallbackName = names[0] ?? DEFAULT_PRESET_NAME;
      const glyphAnchor = keyframes[0]?.presetName ?? fallbackName;
      if (!point) {
        throw new Error('Нет ключевых кадров');
      }
      const from = presets[point.fromName] ?? presets[fallbackName]!;
      const to = presets[point.toName] ?? presets[fallbackName]!;
      const anchor = presets[glyphAnchor] ?? from;
      const params = {
        ...interpolateStyleParams(from, to, point.localT),
        kerningPairs: anchor.kerningPairs,
      };
      const assets = assetsFor(glyphAnchor, glyphsByStyle, ligaturesByStyle);
      const ctx: RenderContext = {
        params: { ...params, showGrid: false, showGuides: false },
        fontPaths,
        fontAlphabet,
        customGlyphs: assets.glyphs,
        ligatures: assets.ligatures,
      };
      const frameSvg = renderTextSvg(specimen, ctx, 1, {
        paintBackground: true,
        contain: false,
        lockedFrame,
      });
      await paintSvgOnCanvas(frameSvg, canvas, params.background);
    },
    [
      fontAlphabet,
      fontPaths,
      glyphsByStyle,
      keyframes,
      ligaturesByStyle,
      lockedFrame,
      names,
      presets,
      specimen,
    ],
  );

  const exportVideo = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    setPlaying(false);
    setExportProgress(0);
    setStatus('Подготовка кадра…');
    try {
      const probe = resolveAt(0);
      const assets = assetsFor(probe.styleName, glyphsByStyle, ligaturesByStyle);
      const probeCtx: RenderContext = {
        params: { ...probe.params, showGrid: false, showGuides: false },
        fontPaths,
        fontAlphabet,
        customGlyphs: assets.glyphs,
        ligatures: assets.ligatures,
      };
      const probeSvg = renderTextSvg(specimen, probeCtx, 1, {
        paintBackground: true,
        contain: false,
        lockedFrame,
      });
      const box = parseViewBox(probeSvg);
      const scale = Math.min(1920 / Math.max(box.width, 1), 1080 / Math.max(box.height, 1), 2);
      canvas.width = Math.max(16, Math.round(box.width * scale));
      canvas.height = Math.max(16, Math.round(box.height * scale));
      await paintSvgOnCanvas(probeSvg, canvas, probe.params.background);

      const { exportToVideo, videoExtensionFor } = await import('../../engine/videoExporter');
      const blob = await exportToVideo(canvas, renderExportFrame, {
        fps: 60,
        durationSec,
        easing,
        onProgress: (progress) => {
          setExportProgress(progress);
          setStatus(`Рендеринг: ${progress}%`);
        },
      });
      const ext = videoExtensionFor(blob.type);
      downloadBlob(blob, `compresso-morph.${ext}`);
      setStatus(ext === 'mp4' ? 'MP4 сохранён' : 'WebM сохранён (браузер без MP4)');
    } catch (error) {
      setStatus(`Не удалось записать видео: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setExportProgress(null);
    }
  }, [
    durationSec,
    easing,
    fontAlphabet,
    fontPaths,
    glyphsByStyle,
    ligaturesByStyle,
    lockedFrame,
    renderExportFrame,
    resolveAt,
    specimen,
  ]);

  const embedCode = useMemo(() => {
    const states = keyframes.map((frame) => {
      const params = presets[frame.presetName] ?? presets[names[0]!]!;
      return keyframeFromParams(params);
    });
    const firstName = keyframes[0]?.presetName ?? names[0]!;
    const firstParams = presets[firstName] ?? presets[names[0]!]!;
    const grids = occupancyForText(
      specimen,
      firstParams,
      assetsFor(firstName, glyphsByStyle, ligaturesByStyle).glyphs,
    );
    return generateWebEmbedCode({
      text: specimen,
      keyframes: states,
      glyphGrids: grids,
      mode: embedMode,
      durationSec,
      fill: firstParams.fill,
    });
  }, [durationSec, embedMode, glyphsByStyle, keyframes, ligaturesByStyle, names, presets, specimen]);

  const copyEmbed = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(embedCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setStatus('Не удалось скопировать — выделите код вручную');
    }
  }, [embedCode]);

  const segmentLabel =
    sample && sample.segmentCount > 0
      ? `Сегмент ${sample.segmentIndex + 1}/${sample.segmentCount}: ${sample.fromName} → ${sample.toName} · step ${morphParams.stepX.toFixed(1)}×${morphParams.stepY.toFixed(1)} · track ${morphParams.letterSpacing.toFixed(1)} · dens ${morphParams.colScale}×${morphParams.rowScale}`
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="shrink-0 rounded-lg border border-studio-border bg-studio-surface p-3">
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-[11px] tracking-wide text-studio-muted">Ключевые кадры</p>
            <p className="text-[11px] text-studio-faint">
              Выберите начертание из списка или введите новое имя. Морф между соседними кадрами
              считает сервис по easing.
            </p>
          </div>
          <Button
            compact
            onClick={addKeyframe}
            title="Добавить ключевой кадр в конец цепочки"
          >
            <Plus size={14} aria-hidden />
            Добавить кадр
          </Button>
        </div>
        <ol className="flex flex-col gap-2">
          {keyframes.map((frame, index) => (
            <li
              key={frame.id}
              className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-end gap-2"
            >
              <span className="pb-2 font-mono text-[11px] text-studio-faint">
                KF{index + 1}
              </span>
              <Combobox
                label={index === 0 ? 'Начертание' : undefined}
                value={frame.presetName}
                options={names}
                placeholder="Выбрать или создать начертание"
                onSelect={(name) => setKeyframePreset(frame.id, name)}
                onCreate={(name) =>
                  createKeyframePreset(frame.id, name, frame.presetName || activePreset)
                }
              />
              <Button
                compact
                disabled={keyframes.length <= 2}
                onClick={() => removeKeyframe(frame.id)}
                title={
                  keyframes.length <= 2
                    ? 'Нужны минимум два ключевых кадра'
                    : 'Удалить ключевой кадр'
                }
              >
                <Trash2 size={14} aria-hidden />
              </Button>
            </li>
          ))}
        </ol>
        <div className="mt-3">
          <label className="block">
            <span className="mb-1 block text-[11px] tracking-wide text-studio-muted">
              Текст (All-Caps)
            </span>
            <input
              type="text"
              value={text}
              onChange={(event) => onTextChange(event.target.value.toUpperCase())}
              className="w-full rounded border border-studio-border bg-studio-panel px-3 py-2 font-mono text-[15px] tracking-wide text-studio-text outline-none focus:border-studio-border-strong"
              aria-label="Текст для анимации"
            />
          </label>
        </div>
      </div>

      <div
        className="relative min-h-0 w-full flex-1 overflow-hidden rounded-lg border border-studio-border"
        style={{ backgroundColor: morphParams.background }}
      >
        <SvgCanvas svg={svg} fluid className="h-full w-full" />
        {segmentLabel ? (
          <div className="pointer-events-none absolute right-2 bottom-2 rounded bg-black/55 px-2 py-1 font-mono text-[10px] text-white/85">
            {segmentLabel}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col gap-3 rounded-lg border border-studio-border bg-studio-surface p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" compact onClick={togglePlay} title="Пробел — Play / Pause">
            {playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}
            {playing ? 'Pause' : 'Play'}
          </Button>
          <div className="min-w-[200px] flex-1">
            <Slider
              label="Кадр t"
              value={mix * 100}
              min={0}
              max={100}
              step={0.5}
              suffix="%"
              onChange={(value) => {
                setPlaying(false);
                setMix(value / 100);
              }}
            />
          </div>
          <div className="w-[180px]">
            <Slider
              label="Duration"
              value={durationSec}
              min={0.5}
              max={6}
              step={0.1}
              suffix="s"
              onChange={setDurationSec}
            />
          </div>
        </div>
        <RadioGroup<EasingFunction>
          label="Easing (между соседними кадрами / по всей цепочке)"
          value={easing}
          columns={4}
          options={EASING_LABELS}
          onChange={setEasing}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            compact
            onClick={() => void exportVideo()}
            disabled={exportProgress !== null}
          >
            <Download size={14} aria-hidden />
            {exportProgress !== null ? `Рендеринг: ${exportProgress}%` : 'Скачать MP4'}
          </Button>
          <Button compact onClick={() => setEmbedOpen(true)}>
            Встроить на сайт
          </Button>
          <Button
            compact
            onClick={() => {
              const name = nextOrdinalStyleName(names);
              const source = keyframes[keyframes.length - 1]?.presetName ?? activePreset;
              const error = onCreatePreset(name, source);
              if (error) {
                setStatus(error);
                return;
              }
              setKeyframes((current) => [
                ...current,
                { id: newTimelineKeyframeId(), presetName: name },
              ]);
              setStatus(`Добавлен кадр «${name}»`);
            }}
            title="Создать новое начертание и добавить его как следующий ключевой кадр"
          >
            <Plus size={14} aria-hidden />
            Новое начертание + кадр
          </Button>
          {status ? (
            <span className="font-mono text-[11px] text-studio-muted">{status}</span>
          ) : (
            <span className="text-[11px] text-studio-faint">Пробел — Play / Pause</span>
          )}
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="pointer-events-none fixed top-0 left-[-9999px] h-px w-px opacity-0"
        aria-hidden
      />

      {embedOpen ? (
        <Modal
          title="Встроить на сайт"
          onClose={() => setEmbedOpen(false)}
          actions={
            <>
              <Button onClick={() => setEmbedOpen(false)}>Закрыть</Button>
              <Button variant="primary" onClick={() => void copyEmbed()}>
                <Copy size={13} aria-hidden />
                {copied ? 'Скопировано' : 'Скопировать код'}
              </Button>
            </>
          }
        >
          <RadioGroup<EmbedMode>
            label="Режим интерактивности"
            value={embedMode}
            columns={3}
            options={[
              { value: 'loop', label: 'Бесконечный луп' },
              { value: 'hover', label: 'По наведению' },
              { value: 'scroll', label: 'По скроллу' },
            ]}
            onChange={setEmbedMode}
          />
          <p className="mt-3 mb-2 text-[11px] text-studio-faint">
            В коде — вся цепочка из {keyframes.length} ключевых кадров. Вставьте блок в HTML
            Tilda / Webflow / WordPress.
          </p>
          <textarea
            readOnly
            value={embedCode}
            className="h-48 w-full rounded border border-studio-border bg-studio-panel p-2 font-mono text-[10px] text-studio-text"
            aria-label="Код для вставки"
          />
        </Modal>
      ) : null}
    </div>
  );
}
