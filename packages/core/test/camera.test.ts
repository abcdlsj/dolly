import { describe, expect, test } from "bun:test";
import {
  buildFilter,
  Camera,
  canvas,
  ceilingFor,
  key,
  parseAspect,
  parseKeyframe,
  planShot,
  review,
  ShotError,
  UsageError,
  type BeatSpec,
  type Key,
  type Size,
} from "../src/index.ts";

describe("geometry", () => {
  const sizes: Size[] = [[2560, 1600], [2880, 1200], [1600, 2400], [1280, 800]];

  test("the canvas is 16:9 and holds the window", () => {
    for (const size of sizes) {
      const [w, h, x, y] = canvas(size, "pad");
      expect(w / h).toBeCloseTo(16 / 9, 2);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      const [cw, ch] = canvas(size, "crop");
      expect(cw / ch).toBeCloseTo(16 / 9, 2);
      expect(cw).toBeLessThanOrEqual(size[0]);
      expect(ch).toBeLessThanOrEqual(size[1]);
    }
  });

  test("the ceiling follows the canvas and never drops below one", () => {
    expect(ceilingFor([2560, 1600], "crop")).toBe(1.333);
    expect(ceilingFor([2880, 1200], "crop")).toBe(1.111);
    expect(ceilingFor([1600, 2400], "pad")).toBeGreaterThan(2);
    expect(ceilingFor([1280, 800], "pad")).toBe(1);
  });

  test("start does not shift keyframes", () => {
    const graph = buildFilter([key(0, 1), key(1, 1.3)], [2560, 1600], 1, null, 1.333);
    expect(graph).toContain("trim=start=1,");
    expect(graph).toContain("lt(t,1.0000)");
    expect(graph).not.toContain("2.0000");
  });

  test("keyframe and aspect parsing", () => {
    expect(parseKeyframe("1:1.2:0.3:0.4:out").ease).toBe("out");
    expect(parseKeyframe("1:1.2").x).toBe(0.5);
    expect(() => parseKeyframe("1")).toThrow(UsageError);
    expect(() => parseKeyframe("1:1.2:0.3:0.4:wobble")).toThrow(UsageError);
    expect(parseAspect("16:9")).toEqual([1920, 1080]);
    expect(parseAspect("9:16")).toEqual([1080, 1920]);
    expect(parseAspect("1:1")).toEqual([1080, 1080]);
    expect(parseAspect("4:5")).toEqual([1080, 1350]);
  });
});

describe("curves", () => {
  const build = (keys: Key[]) => Camera.build(keys, [2560, 1600], "pad", 1.481, [1920, 1080]);

  test("two keyframes are a smoothstep", () => {
    const path = build([key(0, 1, 0.4), key(2, 1, 0.6)]);
    const [start, end] = [path.x.at(0), path.x.at(2)];
    for (const t of [0.5, 1, 1.5]) {
      const u = t / 2;
      expect(path.x.at(t)).toBeCloseTo(start + (end - start) * u * u * (3 - 2 * u), 6);
    }
  });

  test("a move through a keyframe does not stall there", () => {
    const path = build([key(0, 1.2, 0.3), key(1, 1.2, 0.5), key(2, 1.2, 0.7)]);
    expect((path.x.at(1.01) - path.x.at(0.99)) / 0.02).toBeGreaterThan(0.1);
  });

  test("a repeated keyframe holds", () => {
    const path = build([key(0, 1, 0.3), key(1, 1, 0.5), key(1.5, 1, 0.5), key(2.5, 1, 0.7)]);
    expect(path.x.at(1.5)).toBeCloseTo(path.x.at(1), 9);
    expect(path.x.at(1.25)).toBeCloseTo(path.x.at(1), 9);
  });

  test("the spline never overshoots", () => {
    const path = build([key(0, 1, 0.2), key(0.3, 1, 0.6), key(3, 1, 0.62)]);
    const peak = Math.max(...Array.from({ length: 301 }, (_, i) => path.x.at(i / 100)));
    expect(peak).toBeLessThanOrEqual(path.x.at(3) + 1e-9);
  });

  test("zoom eases in ratio", () => {
    expect(build([key(0, 1), key(2, 1.44)]).view(1)[0]).toBeCloseTo(1.2, 6);
  });

  test("the ffmpeg expression matches the curve", () => {
    const path = build([key(0, 1, 0.3), key(1, 1.2, 0.5, 0.5, "out"), key(2, 1.3, 0.7, 0.5, "back")]);
    const expression = path.x.expression("T");
    const evaluate = new Function(
      "T", "clip", "lt",
      `const _if = (c, a, b) => (c ? a : b); return ${expression.replaceAll("if(", "_if(")};`,
    );
    const clip = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    for (const t of [0, 0.3, 1, 1.4, 1.9, 2.5]) {
      expect(evaluate(t, clip, (a: number, b: number) => a < b)).toBeCloseTo(path.x.at(t), 5);
    }
  });
});

describe("shots", () => {
  const source: Size = [2560, 1600];
  const plan = (beats: BeatSpec[], length = 6) =>
    planShot(beats, source, "pad", ceilingFor(source, "pad"), [1920, 1080], length);

  test("focus fits the rect", () => {
    const { keys } = plan([{ move: "focus", at: 0.4, rect: [0.4, 0.4, 0.2, 0.2], fill: 0.25 }]);
    const last = keys[keys.length - 1]!;
    // 0.2 of a 1600-high window is 320 px of a 1600 canvas; a quarter of the frame is zoom 1.25.
    expect(last.zoom).toBeCloseTo((0.25 * 1600) / 320, 3);
    expect(last.x).toBeCloseTo(0.5);
    expect(last.y).toBeCloseTo(0.5);
    expect(keys.map((k) => k.t)).toEqual([0, 0.4, 2.2]);
  });

  test("relative and end times", () => {
    const result = plan(
      [
        { move: "focus", at: 0.5, point: [0.3, 0.3], zoom: 1.2 },
        { move: "pan-to", at: "+0.5", point: [0.7, 0.3] },
        { move: "pull-back", at: "end-2" },
      ],
      8,
    );
    expect(result.beats.map((b) => b.start)).toEqual([0.5, 2.8, 6]);
    expect(result.keys[result.keys.length - 1]!.zoom).toBe(1);
  });

  test("overlapping beats are refused", () => {
    expect(() =>
      plan([
        { move: "focus", at: 0.5, point: [0.3, 0.3] },
        { move: "pan-to", at: 1, point: [0.7, 0.3] },
      ]),
    ).toThrow(ShotError);
  });

  test("unknown moves and missing targets are refused", () => {
    expect(() => plan([{ move: "zoom" as never }])).toThrow(ShotError);
    expect(() => plan([{ move: "pan-to" }])).toThrow(ShotError);
    expect(() => plan([])).toThrow(ShotError);
  });

  test("a clamped zoom is reported", () => {
    const result = plan([{ move: "focus", at: 0.5, point: [0.5, 0.5], zoom: 3 }]);
    expect(result.beats[0]!.clamped).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test("tour and drift", () => {
    const { keys } = plan([
      { move: "tour", at: 0.4, zoom: 1.2, stops: [[0.3, 0.3], [0.7, 0.3]], hold: 0.5 },
      { move: "drift" },
    ]);
    expect(keys.map((k) => Math.round(k.t * 100) / 100)).toEqual([0, 0.4, 1.6, 2.1, 3.3, 3.8, 6]);
    expect(keys[keys.length - 1]!.ease).toBe("linear");
    expect(keys[keys.length - 1]!.zoom).toBeCloseTo(1.2 * 1.04);
  });

  test("review flags an early move", () => {
    const result = plan([{ move: "focus", at: 0, point: [0.5, 0.5], zoom: 1.3 }]);
    const path = Camera.build(result.keys, source, "pad", 1.481, [1920, 1080]);
    const { warnings } = review(path, result.keys, result.beats, 6);
    expect(warnings.some((w) => w.includes("before the first move"))).toBe(true);
  });
});
