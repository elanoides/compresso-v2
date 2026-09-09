/**
 * Self-contained HTML/JS snippet for Tilda, Webflow, WordPress HTML blocks.
 * No studio libraries required at runtime.
 */

import type { KeyframeState } from './animationEngine';

export type EmbedMode = 'loop' | 'hover' | 'scroll';

export interface EmbedExportOptions {
  text: string;
  /** Ordered keyframes along the morph path (at least one). */
  keyframes: readonly KeyframeState[];
  glyphGrids: Record<string, boolean[][]>;
  mode: EmbedMode;
  durationSec: number;
  fill?: string;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export function generateWebEmbedCode(options: EmbedExportOptions): string {
  const frames = options.keyframes.length > 0 ? options.keyframes : [];
  const payload = safeJson({
    text: options.text,
    frames,
    grids: options.glyphGrids,
    mode: options.mode,
    duration: options.durationSec * 1000,
    fill: options.fill ?? '#ffffff',
  });

  return `<!-- Compresso Parametric Typography Embed -->
<div id="compresso-embed-root" style="width: 100%; position: relative; overflow: hidden; background: transparent;">
  <canvas id="compresso-canvas" style="display: block; width: 100%; height: auto;"></canvas>
</div>
<script>
(function() {
  const data = ${payload};
  const canvas = document.getElementById('compresso-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const frames = Array.isArray(data.frames) && data.frames.length ? data.frames : [];

  let cssW = 0;
  let cssH = 0;
  let progress = 0;
  let targetProgress = 0;
  let startTime = null;

  function lerp(v0, v1, t) { return v0 + (v1 - v0) * t; }

  function sampleFrame(t) {
    if (!frames.length) {
      return { rx: 12, ry: 5, letterSpacing: 1, stepX: 38.5, stepY: 16, colScale: 1, rowScale: 1, fillOpacity: 1 };
    }
    if (frames.length === 1) {
      return frames[0];
    }
    const u = Math.max(0, Math.min(1, t));
    const segmentCount = frames.length - 1;
    const scaled = u * segmentCount;
    const index = Math.min(segmentCount - 1, Math.floor(scaled));
    const localT = Math.max(0, Math.min(1, scaled - index));
    const a = frames[index];
    const b = frames[index + 1];
    return {
      rx: lerp(a.rx, b.rx, localT),
      ry: lerp(a.ry, b.ry, localT),
      letterSpacing: lerp(a.letterSpacing, b.letterSpacing, localT),
      stepX: lerp(a.stepX ?? 38.5, b.stepX ?? 38.5, localT),
      stepY: lerp(a.stepY ?? 16, b.stepY ?? 16, localT),
      colScale: Math.max(1, Math.round(lerp(a.colScale ?? 1, b.colScale ?? 1, localT))),
      rowScale: Math.max(1, Math.round(lerp(a.rowScale ?? 1, b.rowScale ?? 1, localT))),
      fillOpacity: lerp(a.fillOpacity, b.fillOpacity, localT)
    };
  }

  function glyphWidth(grid) {
    if (!grid || !grid.length) return 5;
    let cols = 0;
    for (let r = 0; r < grid.length; r++) {
      cols = Math.max(cols, grid[r] ? grid[r].length : 0);
    }
    return Math.max(1, cols);
  }

  function totalColumns(spacing) {
    let cols = 0;
    for (let i = 0; i < data.text.length; i++) {
      const ch = data.text[i];
      if (ch === ' ') {
        cols += 5 + spacing;
        continue;
      }
      cols += glyphWidth(data.grids[ch]) + spacing;
    }
    return cols + 4;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, cssW * 0.35);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw(progress);
  }

  function draw(t) {
    ctx.clearRect(0, 0, cssW, cssH);
    const frame = sampleFrame(t);
    const spacing = frame.letterSpacing;
    ctx.fillStyle = data.fill;
    ctx.globalAlpha = frame.fillOpacity;

    const cols = totalColumns(spacing);
    const cell = cssW / cols;
    let startX = cell * 2;

    for (let i = 0; i < data.text.length; i++) {
      const ch = data.text[i];
      if (ch === ' ') {
        startX += (5 + spacing) * cell;
        continue;
      }
      const grid = data.grids[ch];
      if (!grid) {
        startX += (5 + spacing) * cell;
        continue;
      }
      const gw = glyphWidth(grid);
      const rxPx = Math.max(0.4, frame.rx * (cell / Math.max(frame.stepX || 38.5, 1)));
      const ryPx = Math.max(0.4, frame.ry * (cell / Math.max(frame.stepY || 16, 1)));
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        if (!row) continue;
        for (let c = 0; c < row.length; c++) {
          if (!row[c]) continue;
          const cx = startX + (c + 0.5) * cell;
          const cy = (r + 0.5) * (cssH / 32);
          ctx.beginPath();
          ctx.ellipse(cx, cy, rxPx, ryPx, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      startX += (gw + spacing) * cell;
    }
    ctx.globalAlpha = 1;
  }

  function loop(now) {
    if (!startTime) startTime = now;
    if (data.mode === 'loop') {
      const elapsed = (now - startTime) % data.duration;
      const linearT = elapsed / data.duration;
      progress = (1 - Math.cos(2 * Math.PI * linearT)) / 2;
    } else {
      progress += (targetProgress - progress) * 0.1;
    }
    draw(progress);
    requestAnimationFrame(loop);
  }

  if (data.mode === 'hover') {
    canvas.addEventListener('mouseenter', function() { targetProgress = 1; });
    canvas.addEventListener('mouseleave', function() { targetProgress = 0; });
  } else if (data.mode === 'scroll') {
    window.addEventListener('scroll', function() {
      const rect = canvas.getBoundingClientRect();
      const windowH = window.innerHeight || 1;
      const centerOffset = (windowH - rect.top) / (windowH + rect.height);
      targetProgress = Math.max(0, Math.min(1, centerOffset));
    }, { passive: true });
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(loop);
})();
</script>`;
}
