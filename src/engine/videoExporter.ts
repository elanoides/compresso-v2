/**
 * Capture a canvas animation to MP4 (H.264) or WebM via MediaRecorder.
 */

import { applyEasing, type EasingFunction } from './animationEngine';

export interface VideoExportOptions {
  fps?: number;
  durationSec?: number;
  easing?: EasingFunction;
  onProgress?: (progress: number) => void;
}

function pickMimeType(): string {
  const candidates = [
    'video/mp4; codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm; codecs=vp9',
    'video/webm; codecs=vp8',
    'video/webm',
  ];
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return 'video/webm';
  }
  for (const type of candidates) {
    if (MediaRecorder.isTypeSupported(type)) {
      return type;
    }
  }
  return 'video/webm';
}

export function videoExtensionFor(mimeType: string): 'mp4' | 'webm' {
  return mimeType.includes('mp4') ? 'mp4' : 'webm';
}

function waitFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Drive `renderFrameAt` across the shot and record the canvas stream.
 * `t` passed to the renderer is already eased into 0…1.
 */
export async function exportToVideo(
  canvas: HTMLCanvasElement,
  renderFrameAt: (t: number) => void | Promise<void>,
  options: VideoExportOptions = {},
): Promise<Blob> {
  const { fps = 60, durationSec = 3, easing = 'pingPong', onProgress } = options;

  if (typeof canvas.captureStream !== 'function') {
    throw new Error('Этот браузер не умеет записывать canvas в видео');
  }
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('MediaRecorder недоступен в этом браузере');
  }

  const mimeType = pickMimeType();
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 10_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      chunks.push(event.data);
    }
  };

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
    recorder.onerror = () => reject(new Error('Запись видео прервалась'));
  });

  recorder.start(100);
  await waitFrame();

  const totalFrames = Math.max(1, Math.round(fps * durationSec));
  for (let frame = 0; frame < totalFrames; frame += 1) {
    const linearT = frame / totalFrames;
    const easedT = applyEasing(linearT, easing);
    await renderFrameAt(easedT);
    onProgress?.(Math.round(((frame + 1) / totalFrames) * 100));
    await waitFrame();
  }

  if (recorder.state === 'recording') {
    recorder.stop();
  }
  return stopped;
}
