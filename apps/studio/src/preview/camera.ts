// The preview runs the real camera from @dolly/core: the same spline the
// renderer uses decides where the frame sits at every moment. Studio only
// picks the keyframes for each named move, since the agent's shot list says
// which move, not where its keys fall.

import { key, shot as planShot, type Key, type Move, type Shot as CoreShot, type View } from "@dolly/core";
import type { Film, Shot } from "../model/types.ts";

/** A Retina window, the size most takes are recorded at. */
export const SOURCE: readonly [number, number] = [2880, 1800];
const FOCUS: readonly [number, number] = [0.66, 0.66];

export function previewKeys(move: Move, seconds: number, focus: readonly [number, number] = FOCUS): Key[] {
  const t = Math.max(seconds, 1);
  const [x, y] = focus;
  switch (move) {
    case "hold":
      return [key(0, 1), key(t, 1)];
    case "focus":
    case "frame":
      return [key(0, 1), key(t * 0.55, 1.35, x, y), key(t, 1.38, x, y)];
    case "punch-in":
      return [key(0, 1), key(t * 0.35, 1, 0.5, 0.5), key(t * 0.45, 1.5, x, y, "out"), key(t, 1.52, x, y)];
    case "pull-back":
      return [key(0, 1.45, x, y), key(t * 0.7, 1, 0.5, 0.5), key(t, 1)];
    case "pan-to":
      return [key(0, 1.3, 0.32, 0.5), key(t, 1.3, x, y)];
    case "drift":
      return [key(0, 1.12, 0.47, 0.5), key(t, 1.2, 0.54, 0.53)];
    case "tour":
      return [key(0, 1.3, 0.35, 0.4), key(t / 3, 1.3, 0.62, 0.45), key((2 * t) / 3, 1.3, x, y), key(t, 1.3, x, y)];
  }
}

const cache = new Map<string, CoreShot>();

export function cameraFor(move: Move, seconds: number, aspect = "16:9"): CoreShot {
  const id = `${move}:${seconds}:${aspect}`;
  let planned = cache.get(id);
  if (!planned) {
    planned = planShot({ source: SOURCE, keys: previewKeys(move, seconds), aspect, fit: "pad", length: seconds });
    cache.set(id, planned);
  }
  return planned;
}

export function viewOf(shot: Pick<Shot, "move" | "seconds">, t: number, aspect = "16:9"): View {
  return cameraFor(shot.move, shot.seconds, aspect).camera.view(Math.min(Math.max(t, 0), shot.seconds));
}

export interface Placed {
  shot: Shot;
  start: number;
  end: number;
}

export function timeline(film: Film): Placed[] {
  let at = 0;
  return film.shots.map((shot) => {
    const placed = { shot, start: at, end: at + shot.seconds };
    at = placed.end;
    return placed;
  });
}

export function duration(film: Film): number {
  return film.shots.reduce((sum, shot) => sum + shot.seconds, 0);
}

export function at(film: Film, t: number, aspect = "16:9"): { placed: Placed; view: View } | null {
  const placed = timeline(film).find((item) => t < item.end) ?? timeline(film).at(-1);
  if (!placed) return null;
  return { placed, view: viewOf(placed.shot, t - placed.start, aspect) };
}

/** The visible part of the canvas, in percent, for the framing corners. */
export function frameRect(view: View): { left: number; top: number; width: number; height: number } {
  const [zoom, x, y] = view;
  const size = 100 / zoom;
  return { left: x * 100 - size / 2, top: y * 100 - size / 2, width: size, height: size };
}

/** CSS transform that shows what the camera shows. */
export function transform(view: View): string {
  const [zoom, x, y] = view;
  return `scale(${zoom.toFixed(4)}) translate(${((0.5 - x) * 100).toFixed(3)}%, ${((0.5 - y) * 100).toFixed(3)}%)`;
}
