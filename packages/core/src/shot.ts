// Named moves (a shot file's beats) expanded into keyframes.

import { key, type Key } from "./camera.ts";
import { CAMERA_EASE_NAMES, isCameraEase, type CameraEase } from "./eases.ts";
import { canvas, clamp, type Fit, type Size } from "./geometry.ts";

export const MOVES = ["hold", "focus", "frame", "pull-back", "pan-to", "punch-in", "drift", "tour"] as const;
export type Move = (typeof MOVES)[number];

const DEFAULT_LENGTH: Record<Exclude<Move, "drift" | "tour">, number> = {
  hold: 0.5,
  focus: 1.8,
  frame: 1.6,
  "pull-back": 1.6,
  "pan-to": 1.4,
  "punch-in": 0.35,
};

/** Window-normalised `[x, y]` or `[x, y, w, h]`. */
export type Point = readonly [number, number];
export type Rect = readonly [number, number, number, number];
export type Stop = Point | { point?: Point; rect?: Rect };

/** A beat as a shot file writes it. Times: seconds, `+0.5` after the previous beat, or `end-2`. */
export interface BeatSpec {
  move: Move;
  at?: number | string;
  for?: number;
  ease?: CameraEase;
  point?: Point;
  rect?: Rect;
  zoom?: number;
  fill?: number;
  amount?: number;
  stops?: Stop[];
  travel?: number;
  hold?: number;
}

/** Where a beat landed on the timeline, and whether its zoom hit the ceiling. */
export interface Beat {
  move: Move;
  start: number;
  end: number;
  clamped: boolean;
}

export interface Plan {
  keys: Key[];
  beats: Beat[];
  warnings: string[];
}

export class ShotError extends Error {}

function pointOf(beat: { point?: Point; rect?: Rect }): Point | null {
  if (beat.rect) {
    const [x, y, w, h] = beat.rect.map(Number) as unknown as Rect;
    return [x + w / 2, y + h / 2];
  }
  if (beat.point) return [Number(beat.point[0]), Number(beat.point[1])];
  return null;
}

/** The zoom at which `rect` (window-normalised) takes `fill` of the frame. */
export function fitZoom(rect: Rect, fill: number, source: Size, fit: Fit, out: Size): number {
  const [canW, canH] = canvas(source, fit, out);
  const width = Math.max(rect[2] * source[0], 1);
  const height = Math.max(rect[3] * source[1], 1);
  return fill * Math.min(canW / width, canH / height);
}

export function resolveTime(value: number | string | undefined, previousEnd: number, length: number | null): number {
  if (value === undefined || value === null) return previousEnd;
  if (typeof value === "number") return value;
  const text = String(value).trim();
  if (text.startsWith("+")) return previousEnd + parseNumber(text.slice(1));
  if (text.startsWith("end")) {
    if (length === null) throw new ShotError(`${JSON.stringify(text)} needs the take's length`);
    const rest = text.slice(3).trim();
    return length + (rest ? parseNumber(rest) : 0);
  }
  return parseNumber(text);
}

function parseNumber(text: string): number {
  const value = Number(text);
  if (text.trim() === "" || Number.isNaN(value)) throw new ShotError(`bad time ${JSON.stringify(text)}`);
  return value;
}

/** Expand named moves into keyframes, starting on the whole window. */
export function planShot(
  raw: readonly BeatSpec[],
  source: Size,
  fit: Fit,
  ceiling: number,
  out: Size,
  length: number | null,
): Plan {
  let zoom = 1;
  let x = 0.5;
  let y = 0.5;
  const keys: Key[] = [key(0, zoom, x, y)];
  const beats: Beat[] = [];
  const warnings: string[] = [];
  if (!raw.length) throw new ShotError("a shot needs at least one beat");

  const last = () => keys[keys.length - 1]!;
  const place = (t: number, z: number, px: number, py: number, ease: CameraEase) => {
    if (t < last().t - 1e-6) {
      throw new ShotError(
        `beat at ${t.toFixed(2)}s starts before the previous one ends (${last().t.toFixed(2)}s)`,
      );
    }
    if (t - last().t < 1e-6) keys[keys.length - 1] = key(last().t, z, px, py, last().ease);
    else keys.push(key(t, z, px, py, ease));
  };
  const clampZoom = (z: number) => clamp(z, 1, ceiling);

  raw.forEach((beat, index) => {
    const move = beat.move;
    if (!(MOVES as readonly string[]).includes(move)) {
      throw new ShotError(`beat ${index}: unknown move ${JSON.stringify(move)}, want one of ${MOVES.join(", ")}`);
    }
    const start = resolveTime(beat.at, last().t, length);
    // Whatever came before holds until this beat begins.
    place(start, zoom, x, y, "spline");

    let duration: number;
    if (move === "drift") {
      const following = raw[index + 1]?.at;
      const defaultEnd =
        following !== undefined ? resolveTime(following, start, length) : length !== null ? length : start + 3;
      duration = Number(beat.for ?? defaultEnd - start);
    } else if (move === "tour") {
      duration = 0;
    } else {
      duration = Number(beat.for ?? DEFAULT_LENGTH[move]);
    }
    if (move !== "tour" && !(duration > 0)) throw new ShotError(`beat ${index} (${move}): duration must be positive`);
    const ease = beat.ease;
    if (ease !== undefined && !isCameraEase(ease)) {
      throw new ShotError(`beat ${index}: unknown ease ${JSON.stringify(ease)}, want one of ${CAMERA_EASE_NAMES.join(", ")}`);
    }

    const target = (what: string) => {
      const point = pointOf(beat);
      if (!point) throw new ShotError(`beat ${index} (${what}): needs \`rect\` or \`point\``);
      return point;
    };

    let requested: number | null = null;
    switch (move) {
      case "hold":
        place(start + duration, zoom, x, y, "spline");
        break;
      case "focus":
      case "frame": {
        const point = target(move);
        if (beat.zoom !== undefined) requested = Number(beat.zoom);
        else if (beat.rect) requested = fitZoom(beat.rect, Number(beat.fill ?? 0.5), source, fit, out);
        else requested = 1.28;
        zoom = clampZoom(requested);
        [x, y] = point;
        place(start + duration, zoom, x, y, ease ?? "spline");
        break;
      }
      case "pull-back":
        zoom = 1;
        x = 0.5;
        y = 0.5;
        place(start + duration, zoom, x, y, ease ?? "spline");
        break;
      case "pan-to":
        [x, y] = target(move);
        place(start + duration, zoom, x, y, ease ?? "spline");
        break;
      case "punch-in": {
        requested = zoom * Number(beat.amount ?? 1.12);
        zoom = clampZoom(requested);
        const point = pointOf(beat);
        if (point) [x, y] = point;
        place(start + duration, zoom, x, y, ease ?? "back");
        break;
      }
      case "drift":
        requested = zoom * Number(beat.amount ?? 1.04);
        zoom = clampZoom(requested);
        place(start + duration, zoom, x, y, ease ?? "linear");
        break;
      case "tour": {
        const stops = beat.stops ?? [];
        if (!stops.length) throw new ShotError(`beat ${index} (tour): needs \`stops\``);
        const travel = Number(beat.travel ?? 1.2);
        const hold = Number(beat.hold ?? 0.8);
        if (beat.zoom !== undefined) {
          requested = Number(beat.zoom);
          zoom = clampZoom(requested);
        }
        let t = start;
        for (const stop of stops) {
          const point = pointOf(Array.isArray(stop) ? { point: stop as Point } : (stop as { point?: Point; rect?: Rect }));
          if (!point) throw new ShotError(`beat ${index} (tour): each stop needs \`rect\` or \`point\``);
          [x, y] = point;
          t += travel;
          place(t, zoom, x, y, ease ?? "spline");
          if (hold > 0) {
            t += hold;
            place(t, zoom, x, y, "spline");
          }
        }
        duration = t - start;
        break;
      }
    }

    const clamped = requested !== null && requested > ceiling + 1e-6;
    if (clamped) {
      warnings.push(
        `beat ${index} (${move}) asks for zoom ${requested!.toFixed(3)}; clamped to the ceiling ${ceiling.toFixed(3)}`,
      );
    }
    beats.push({ move, start: round4(start), end: round4(start + duration), clamped });
  });

  return { keys, beats, warnings };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
