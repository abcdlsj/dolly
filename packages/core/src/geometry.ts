// The output frame and the canvas a window is brought into before the camera moves.

export type Size = readonly [width: number, height: number];
export type Fit = "pad" | "crop";
/** Canvas width and height, and where the window's top-left sits on it. */
export type Canvas = readonly [width: number, height: number, offsetX: number, offsetY: number];

export const SHORT_SIDE = 1080;
export const HD: Size = [1920, 1080];

export class UsageError extends Error {}

/** `16:9` → the output size, with the short side at 1080. */
export function parseAspect(text: string): Size {
  const parts = text.split(":").map(Number);
  const [across, down] = parts;
  if (parts.length !== 2 || across === undefined || down === undefined || Number.isNaN(across) || Number.isNaN(down)) {
    throw new UsageError(`bad aspect ${JSON.stringify(text)}, want w:h such as 16:9`);
  }
  if (across <= 0 || down <= 0) throw new UsageError(`bad aspect ${JSON.stringify(text)}`);
  if (across >= down) return [Math.round((SHORT_SIDE * across) / down / 2) * 2, SHORT_SIDE];
  return [SHORT_SIDE, Math.round((SHORT_SIDE * down) / across / 2) * 2];
}

/**
 * `pad` keeps the whole window (offsets >= 0), `crop` fills the frame by
 * trimming the sides or the top and bottom (offsets <= 0). Sizes are even so
 * every later scale lands on whole chroma samples.
 */
export function canvas(source: Size, fit: Fit, out: Size = HD): Canvas {
  const [srcW, srcH] = source;
  const [outW, outH] = out;
  const pick = fit === "pad" ? Math.max : Math.min;
  const width = Math.round(pick(srcW, (srcH * outW) / outH) / 2) * 2;
  const height = Math.round(pick(srcH, (srcW * outH) / outW) / 2) * 2;
  return [width, height, Math.floor((width - srcW) / 2), Math.floor((height - srcH) / 2)];
}

/**
 * The deepest zoom that still downscales the canvas, never below 1. A canvas
 * narrower than the output is already upscaled at zoom 1; that is reported as
 * `upscaled` rather than refused, so small windows still render.
 */
export function ceilingFor(source: Size, fit: Fit, out: Size = HD): number {
  return round3(Math.max(canvas(source, fit, out)[0] / out[0], 1));
}

export function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}
