// Peak speeds and the rules from skills/dolly/SKILL.md, checked before any render.

import type { Camera, Key } from "./camera.ts";
import type { Beat } from "./shot.ts";
import { round3 } from "./geometry.ts";

export const SAMPLE_RATE = 60;

export interface Review {
  peak_pan: number;
  peak_zoom_rate: number;
  warnings: string[];
}

export function review(camera: Camera, keys: readonly Key[], beats: readonly Beat[], length: number | null): Review {
  const warnings: string[] = [];
  const lastKey = keys[keys.length - 1]!;
  const end = Math.max(length ?? 0, lastKey.t);
  const steps = Math.max(Math.floor(end * SAMPLE_RATE), 1);
  let pan = 0;
  let zoomRate = 0;
  let firstMotion: number | null = null;
  let lastMotion: number | null = null;
  let previous = camera.view(0);
  for (let i = 1; i <= steps; i++) {
    const view = camera.view(i / SAMPLE_RATE);
    // Pan speed in frame widths per second: canvas travel times the zoom.
    const dx = (view[1] - previous[1]) * view[0];
    const dy = ((view[2] - previous[2]) * view[0] * camera.out[1]) / camera.out[0];
    const speed = Math.hypot(dx, dy) * SAMPLE_RATE;
    const rate = Math.abs(Math.log(view[0] / previous[0])) * SAMPLE_RATE;
    pan = Math.max(pan, speed);
    zoomRate = Math.max(zoomRate, rate);
    if (speed > 1e-3 || rate > 1e-3) {
      firstMotion ??= i / SAMPLE_RATE;
      lastMotion = i / SAMPLE_RATE;
    }
    previous = view;
  }
  if (firstMotion !== null && firstMotion < 0.3) {
    warnings.push(`camera moves at ${firstMotion.toFixed(2)}s; hold 0.3–0.6 s before the first move`);
  }
  if (lastMotion !== null && length !== null && length - lastMotion < 0.3) {
    warnings.push(
      `camera still moving at ${lastMotion.toFixed(2)}s of ${length.toFixed(2)}s; leave 0.3 s still at the end`,
    );
  }
  if (pan > 0.8) warnings.push(`pan peaks at ${pan.toFixed(2)} frame widths/s; above ~0.8 it reads as a blur`);
  if (zoomRate > 0.6 && !beats.some((b) => b.move === "punch-in")) {
    warnings.push(`zoom changes ${zoomRate.toFixed(2)}x/s at its peak; slow it down or use punch-in on purpose`);
  }
  if (length !== null && lastKey.t > length + 1e-6) {
    warnings.push(`last keyframe at ${lastKey.t.toFixed(2)}s is past the end of the take (${length.toFixed(2)}s)`);
  }
  const moves = beats.filter((b) => b.move !== "hold");
  for (let i = 1; i < moves.length; i++) {
    const a = moves[i - 1]!;
    const b = moves[i]!;
    if (b.start - a.start < 1.5 && a.move !== "punch-in" && b.move !== "punch-in") {
      warnings.push(`${a.move} at ${a.start.toFixed(2)}s and ${b.move} at ${b.start.toFixed(2)}s are under 1.5 s apart`);
    }
  }
  return { peak_pan: round3(pan), peak_zoom_rate: round3(zoomRate), warnings };
}
