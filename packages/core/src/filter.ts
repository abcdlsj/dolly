// The ffmpeg filter graph that renders a camera move.

import { Camera, type Key } from "./camera.ts";
import { canvas, HD, type Fit, type Size } from "./geometry.ts";

/**
 * `crop` cannot animate its own width, so the move is built the other way
 * round: the whole frame is scaled by the current zoom (a scale CAN be
 * evaluated per frame), and a constant output-sized window then pans over it.
 * Below the ceiling that scale is a downscale, so nothing is upsampled.
 */
export function buildFilter(
  keys: readonly Key[],
  source: Size,
  start: number,
  duration: number | null,
  ceiling: number,
  fit: Fit = "pad",
  out: Size = HD,
): string {
  const [outW, outH] = out;
  const [canW, canH, offX, offY] = canvas(source, fit, out);
  // `trim` + `setpts` restart the clock at zero, so keyframe times are already
  // relative to the wanted span; adding `start` would shift the move.
  const camera = Camera.build(keys, source, fit, ceiling, out);
  const zoom = camera.zoomExpression();
  const centerX = camera.x.expression();
  const centerY = camera.y.expression();
  const halfW = Math.floor(outW / 2);
  const halfH = Math.floor(outH / 2);
  return [
    duration ? `trim=start=${start}:duration=${duration}` : `trim=start=${start}`,
    "setpts=PTS-STARTPTS",
    // Bring the window into the output aspect first, so the rest of the graph
    // works on a canvas of that shape and never stretches the picture.
    fit === "pad"
      ? `pad=w=${canW}:h=${canH}:x=${offX}:y=${offY}:color=0x0b0b0b`
      : `crop=w=${canW}:h=${canH}:x=${-offX}:y=${-offY}`,
    "setsar=1",
    `scale=w='trunc(${outW}*(${zoom})/2)*2':h='trunc(${outH}*(${zoom})/2)*2':eval=frame:flags=lanczos`,
    `crop=w=${outW}:h=${outH}` +
      `:x='trunc(min(max((${centerX})*${outW}*(${zoom})-${halfW},0),${outW}*(${zoom})-${outW}))'` +
      `:y='trunc(min(max((${centerY})*${outH}*(${zoom})-${halfH},0),${outH}*(${zoom})-${outH}))'`,
    "format=yuv420p",
  ].join(",");
}
