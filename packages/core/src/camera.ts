// Keyframes and the camera path they describe.

import { Channel } from "./channel.ts";
import { CAMERA_EASE_NAMES, isCameraEase, type CameraEase } from "./eases.ts";
import { canvas, clamp, UsageError, type Canvas, type Fit, type Size } from "./geometry.ts";

/**
 * At time `t` the frame shows the window point (`x`, `y`), normalised 0..1, at
 * magnification `zoom`. `ease` is how the camera arrives from the previous key.
 */
export interface Key {
  t: number;
  zoom: number;
  x: number;
  y: number;
  ease: CameraEase;
}

export function key(t: number, zoom: number, x = 0.5, y = 0.5, ease: CameraEase = "spline"): Key {
  return { t, zoom, x, y, ease };
}

/** `t:zoom:x:y:ease`, with `t` in seconds and everything after `zoom` optional. */
export function parseKeyframe(text: string): Key {
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 5) {
    throw new UsageError(`bad keyframe ${JSON.stringify(text)}, want t:zoom:x:y[:ease]`);
  }
  const numbers = parts.slice(0, 4).map((part) => (part.trim() === "" ? Number.NaN : Number(part)));
  if (numbers.some(Number.isNaN)) throw new UsageError(`bad keyframe ${JSON.stringify(text)}`);
  const ease = parts[4] ?? "spline";
  if (!isCameraEase(ease)) {
    throw new UsageError(`bad ease ${JSON.stringify(ease)}, want one of ${CAMERA_EASE_NAMES.join(", ")}`);
  }
  return key(numbers[0]!, numbers[1]!, numbers[2], numbers[3], ease);
}

/** Zoom and the centre of the visible window, canvas-normalised. */
export type View = readonly [zoom: number, x: number, y: number];

/** The camera path of one shot, on the canvas the graph pans over. */
export class Camera {
  constructor(
    /** Natural log of the zoom: equal ratios take equal time. */
    readonly zoom: Channel,
    readonly x: Channel,
    readonly y: Channel,
    readonly ceiling: number,
    readonly out: Size,
    /** The canvas the window was padded or cropped to, which `view` is normalised to. */
    readonly canvas: Canvas,
  ) {}

  static build(keys: readonly Key[], source: Size, fit: Fit, ceiling: number, out: Size): Camera {
    const [srcW, srcH] = source;
    const frame = canvas(source, fit, out);
    const [canW, canH, offX, offY] = frame;
    const times = keys.map((k) => k.t);
    const eases = keys.map((k) => k.ease);
    // Keyframes name a point of the window; the pan works on the canvas, so
    // move each point by the padding or the trim before easing towards it.
    return new Camera(
      Channel.build(times, keys.map((k) => Math.log(clamp(k.zoom, 1, ceiling))), eases),
      Channel.build(times, keys.map((k) => (clamp(k.x, 0, 1) * srcW + offX) / canW), eases),
      Channel.build(times, keys.map((k) => (clamp(k.y, 0, 1) * srcH + offY) / canH), eases),
      ceiling,
      out,
      frame,
    );
  }

  zoomExpression(): string {
    return `min(max(exp(${this.zoom.expression()}),1),${this.ceiling.toFixed(6)})`;
  }

  /** What is on screen at `t`, as rendered: the centre never shows past the canvas edge. */
  view(t: number): View {
    const zoom = clamp(Math.exp(this.zoom.at(t)), 1, this.ceiling);
    const half = 0.5 / zoom;
    return [zoom, clamp(this.x.at(t), half, 1 - half), clamp(this.y.at(t), half, 1 - half)];
  }
}
