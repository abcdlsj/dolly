// A whole shot in one call: plan, camera, review, and what `--explain` prints.

import { Camera, type Key } from "./camera.ts";
import { canvas, ceilingFor, clamp, parseAspect, round3, type Fit, type Size } from "./geometry.ts";
import { review } from "./review.ts";
import { planShot, type Beat, type BeatSpec } from "./shot.ts";

export interface ShotInput {
  source: Size;
  /** Named moves, or explicit keyframes; exactly one of the two. */
  beats?: readonly BeatSpec[];
  keys?: readonly Key[];
  aspect?: string;
  fit?: Fit;
  /** Seconds of take the shot covers, when known. */
  length?: number | null;
}

export interface Explained {
  ok: true;
  source: Size;
  output: Size;
  fit: Fit;
  ceiling: number;
  upscaled: boolean;
  length: number | null;
  keys: string[];
  beats: Beat[];
  peak_pan: number;
  peak_zoom_rate: number;
  warnings: string[];
}

export interface Shot {
  camera: Camera;
  keys: Key[];
  beats: Beat[];
  out: Size;
  fit: Fit;
  ceiling: number;
  upscaled: boolean;
  /** Each key's zoom as rendered. */
  zooms: number[];
  /** Whether any requested zoom was clamped to the ceiling. */
  clamped: boolean;
  warnings: string[];
  explain(): Explained;
}

export function shot(input: ShotInput): Shot {
  return shotFor(input, parseAspect(input.aspect ?? "16:9"));
}

/** As `shot`, for a caller that already has the output size. */
export function shotFor(input: ShotInput, out: Size): Shot {
  const { source, fit = "pad", length = null } = input;
  const ceiling = ceilingFor(source, fit, out);
  let keys: Key[];
  let beats: Beat[] = [];
  const warnings: string[] = [];
  if (input.beats) {
    const plan = planShot(input.beats, source, fit, ceiling, out, length);
    ({ keys, beats } = plan);
    warnings.push(...plan.warnings);
  } else {
    keys = [...(input.keys ?? [])].sort((a, b) => a.t - b.t);
    for (const k of keys) {
      if (k.zoom > ceiling + 1e-6) {
        warnings.push(`zoom ${k.zoom.toFixed(3)} at ${k.t.toFixed(2)}s clamped to the ceiling ${ceiling.toFixed(3)}`);
      }
    }
  }
  const zooms = keys.map((k) => round3(clamp(k.zoom, 1, ceiling)));
  const clamped = keys.some((k, i) => Math.abs(k.zoom - zooms[i]!) > 1e-6) || beats.some((b) => b.clamped);
  const upscaled = canvas(source, fit, out)[0] < out[0];
  if (upscaled) warnings.push(`the canvas is narrower than ${out[0]} px; text will be soft at any zoom`);
  const camera = Camera.build(keys, source, fit, ceiling, out);
  const checks = review(camera, keys, beats, length);
  warnings.push(...checks.warnings);

  return {
    camera, keys, beats, out, fit, ceiling, upscaled, zooms, clamped, warnings,
    explain: () => ({
      ok: true,
      source,
      output: out,
      fit,
      ceiling,
      upscaled,
      length: length !== null ? round3(length) : null,
      keys: keys.map((k, i) => [k.t, zooms[i]!, k.x, k.y].map((v) => v.toFixed(3)).join(":") + `:${k.ease}`),
      beats,
      peak_pan: checks.peak_pan,
      peak_zoom_rate: checks.peak_zoom_rate,
      warnings,
    }),
  };
}
