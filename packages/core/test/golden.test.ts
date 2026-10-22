// The TS core against plans recorded from scripts/camera.py (fixtures/golden.json).
// Keyframes, beats, warnings and the ffmpeg graph must match exactly; sampled
// views to 1e-9, so the switch from Python changes no rendered frame.

import { describe, expect, test } from "bun:test";
import golden from "./fixtures/golden.json";
import { buildFilter, parseKeyframe, shot, type BeatSpec, type Fit, type Size } from "../src/index.ts";

interface Case {
  name: string;
  source: [number, number];
  length: number;
  aspect?: string;
  fit?: Fit;
  beats?: BeatSpec[];
  keys?: string[];
}

describe("matches scripts/camera.py", () => {
  for (const recorded of golden.cases) {
    const c = recorded.case as Case;
    test(c.name, () => {
      const result = shot({
        source: c.source as Size,
        length: c.length,
        aspect: c.aspect ?? "16:9",
        fit: c.fit ?? "pad",
        ...(c.beats ? { beats: c.beats } : { keys: c.keys!.map(parseKeyframe) }),
      });
      const explained = result.explain();
      expect(explained.ceiling).toBe(recorded.ceiling);
      expect(explained.keys).toEqual(recorded.keys);
      expect(explained.beats).toEqual(recorded.beats as never);
      expect(explained.warnings).toEqual(recorded.warnings);
      expect(explained.peak_pan).toBe(recorded.peak_pan);
      expect(explained.peak_zoom_rate).toBe(recorded.peak_zoom_rate);
      for (const [t, ...view] of recorded.views as number[][]) {
        result.camera.view(t!).forEach((value, i) => expect(Math.abs(value - view[i]!)).toBeLessThan(1e-9));
      }
      const graph = buildFilter(result.keys, c.source, 0.5, c.length, result.ceiling, result.fit, result.out);
      // Python prints `duration=10.0` where JS prints `duration=10`; everything after the trim must be identical.
      const afterTrim = (text: string) => text.slice(text.indexOf(","));
      expect(afterTrim(graph)).toBe(afterTrim(recorded.filter));
    });
  }
});
