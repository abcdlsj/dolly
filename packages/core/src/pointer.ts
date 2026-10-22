// Pointer travel, planned here and played back by a platform driver.
//
// A driver only posts what it is given, at the time it is given, so every
// platform moves the pointer along the same curve.

import { POINTER_EASES, type PointerEase } from "./eases.ts";

export interface ScreenPoint {
  x: number;
  y: number;
}

/** One pointer position, `ms` after the travel starts. */
export interface Sample extends ScreenPoint {
  ms: number;
}

/**
 * Minimum spacing between events. Posting a HID event costs a few
 * milliseconds on its own, so drivers pace playback by wall clock and drop a
 * sample they are already late for rather than stretching the move.
 */
export const STEP_MS = 4;

/** Accepts `x,y` or `x y` so an agent can pass either from a shell. */
export function parsePoint(text: string): ScreenPoint | null {
  const parts = text.split(/[ ,]+/).filter(Boolean).map(Number);
  if (parts.length !== 2 || parts.some(Number.isNaN)) return null;
  return { x: parts[0]!, y: parts[1]! };
}

export function distance(a: ScreenPoint, b: ScreenPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * The polyline from `from` through `path`, sampled every `step` ms on an
 * eased clock. Distance (not segment count) is eased, so a path through
 * several points keeps one speed profile instead of stopping at each.
 * The last sample is always the last point, at exactly `ms`.
 */
export function travel(
  from: ScreenPoint,
  path: readonly ScreenPoint[],
  ms: number,
  ease: PointerEase = "inOut",
  step = STEP_MS,
): Sample[] {
  const stops = [from, ...path];
  const cumulative = [0];
  for (let i = 1; i < stops.length; i++) cumulative.push(cumulative[i - 1]! + distance(stops[i - 1]!, stops[i]!));
  const total = cumulative[cumulative.length - 1]!;
  const end = path[path.length - 1];
  if (!end) return [];
  const duration = Math.max(ms, 0);
  if (total <= 0 || duration === 0) return [{ ms: duration, x: end.x, y: end.y }];

  const curve = POINTER_EASES[ease];
  const samples: Sample[] = [];
  const count = Math.max(Math.ceil(duration / step), 1);
  for (let i = 0; i <= count; i++) {
    const at = Math.min(i * step, duration);
    const point = along(curve(at / duration) * total, stops, cumulative);
    samples.push({ ms: at, ...point });
  }
  return samples;
}

function along(at: number, stops: readonly ScreenPoint[], cumulative: readonly number[]): ScreenPoint {
  for (let i = 1; i < stops.length; i++) {
    if (at <= cumulative[i]!) {
      const span = cumulative[i]! - cumulative[i - 1]!;
      const local = span > 0 ? (at - cumulative[i - 1]!) / span : 1;
      const a = stops[i - 1]!;
      const b = stops[i]!;
      return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
    }
  }
  const last = stops[stops.length - 1]!;
  return { x: last.x, y: last.y };
}
