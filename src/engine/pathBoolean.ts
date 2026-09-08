/**
 * Boolean path union for antiqua outlines.
 * Cubics are flattened to polygons, unioned with polygon-clipping (MIT),
 * then rebuilt as linear closed contours with PostScript winding (outer CCW).
 */

import polygonClipping from 'polygon-clipping';

import type { PathSegment } from './svgPath';
import {
  contourSignedArea,
  reverseContour,
  splitContours,
} from './svgPath';

type Ring = Array<[number, number]>;
type Polygon = Ring[];

const FLATTEN_STEPS = 8;

function cubicPoint(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const u = 1 - t;
  const tt = t * t;
  const uu = u * u;
  const uuu = uu * u;
  const ttt = tt * t;
  return [
    uuu * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + ttt * p3[0],
    uuu * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + ttt * p3[1],
  ];
}

function quadPoint(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  t: number,
): [number, number] {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}

/** Flatten one closed contour to a ring (first==last). */
export function contourToRing(segments: readonly PathSegment[]): Ring | null {
  const ring: Ring = [];
  let cursor: [number, number] | null = null;
  let start: [number, number] | null = null;

  const push = (pt: [number, number]) => {
    const prev = ring[ring.length - 1];
    if (prev && Math.hypot(prev[0] - pt[0], prev[1] - pt[1]) < 1e-6) {
      return;
    }
    ring.push(pt);
  };

  for (const seg of segments) {
    if (seg.type === 'M') {
      cursor = [seg.x, seg.y];
      start = cursor;
      push(cursor);
    } else if (seg.type === 'L' && cursor) {
      cursor = [seg.x, seg.y];
      push(cursor);
    } else if (seg.type === 'C' && cursor) {
      const p0 = cursor;
      const p1: [number, number] = [seg.x1, seg.y1];
      const p2: [number, number] = [seg.x2, seg.y2];
      const p3: [number, number] = [seg.x, seg.y];
      for (let i = 1; i <= FLATTEN_STEPS; i += 1) {
        push(cubicPoint(p0, p1, p2, p3, i / FLATTEN_STEPS));
      }
      cursor = p3;
    } else if (seg.type === 'Q' && cursor) {
      const p0 = cursor;
      const p1: [number, number] = [seg.x1, seg.y1];
      const p2: [number, number] = [seg.x, seg.y];
      for (let i = 1; i <= FLATTEN_STEPS; i += 1) {
        push(quadPoint(p0, p1, p2, i / FLATTEN_STEPS));
      }
      cursor = p2;
    } else if (seg.type === 'Z' && start) {
      push(start);
      cursor = start;
    }
  }

  if (ring.length < 3) {
    return null;
  }
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-6) {
    ring.push([first[0], first[1]]);
  }
  return ring;
}

function ringToContour(ring: Ring): PathSegment[] {
  if (ring.length < 4) {
    return [];
  }
  // Drop duplicate closing vertex for M/L chain, then Z.
  const n = ring.length - 1;
  const out: PathSegment[] = [{ type: 'M', x: ring[0]![0], y: ring[0]![1] }];
  for (let i = 1; i < n; i += 1) {
    out.push({ type: 'L', x: ring[i]![0], y: ring[i]![1] });
  }
  out.push({ type: 'Z' });
  return out;
}

function ringSignedArea(ring: Ring): number {
  let area = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const [x0, y0] = ring[i]!;
    const [x1, y1] = ring[i + 1]!;
    area += x0 * y1 - x1 * y0;
  }
  return area / 2;
}

/**
 * Union closed contours into a single path.
 * Outer rings are forced CCW (PostScript / CFF); holes CW.
 */
export function unionPathSegments(contours: readonly PathSegment[]): PathSegment[] {
  const polygons: Polygon[] = [];
  for (const contour of splitContours(contours)) {
    const ring = contourToRing(contour);
    if (!ring) {
      continue;
    }
    polygons.push([ring]);
  }
  if (polygons.length === 0) {
    return [];
  }
  if (polygons.length === 1) {
    return ensurePostScriptWinding(contours);
  }

  type MultiPolygon = Polygon[];
  let result: MultiPolygon = polygonClipping.union(
    polygons[0]!,
    ...polygons.slice(1),
  ) as MultiPolygon;

  const out: PathSegment[] = [];
  for (const poly of result) {
    if (!poly || poly.length === 0) {
      continue;
    }
    for (let r = 0; r < poly.length; r += 1) {
      const ring = poly[r]!;
      if (ring.length < 4) {
        continue;
      }
      let contour = ringToContour(ring);
      const area = ringSignedArea(ring);
      // Outer (r==0): CCW (+); holes: CW (−).
      if (r === 0 && area < 0) {
        contour = reverseContour(contour);
      } else if (r > 0 && area > 0) {
        contour = reverseContour(contour);
      }
      out.push(...contour);
    }
  }
  return out;
}

/** Force every contour CCW — used when no holes are expected. */
export function ensurePostScriptWinding(segments: readonly PathSegment[]): PathSegment[] {
  const out: PathSegment[] = [];
  for (const contour of splitContours(segments)) {
    out.push(...(contourSignedArea(contour) < 0 ? reverseContour(contour) : contour));
  }
  return out;
}
