// `dolly camera` against synthetic takes: a grey window with one red marker.
// The render cases need ffmpeg and skip without it.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fakeContext } from "../src/fake.ts";
import { run as runArgv } from "../src/run.ts";
import { frameRate } from "../src/verbs/camera.ts";

const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const HAS_FFMPEG = spawnSync("ffmpeg", ["-version"]).status === 0 && spawnSync("ffprobe", ["-version"]).status === 0;
const directory = mkdtempSync(join(tmpdir(), "dolly-camera-"));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
const path = (name: string) => join(directory, name);

function ffmpeg(args: string[]): Buffer {
  const result = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { maxBuffer: 256 << 20 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
}

function makeTake(file: string, [width, height]: [number, number], marker: [number, number], seconds = 3) {
  const x = Math.trunc(width * marker[0]) - 12;
  const y = Math.trunc(height * marker[1]) - 12;
  ffmpeg([
    "-y", "-f", "lavfi", "-i", `color=c=gray:s=${width}x${height}:d=${seconds}:r=30`,
    "-vf", `drawbox=x=${x}:y=${y}:w=24:h=24:color=red:t=fill`, "-pix_fmt", "yuv420p", file,
  ]);
}

/** Red marker pixels in one frame at `at`, as [x, y] in a frame `width` wide. */
function redPixels(file: string, at: number, width?: number, height?: number): [number, number][] {
  const scale = width ? ["-vf", `scale=${width}:${height}`] : [];
  const raw = ffmpeg(["-ss", String(at), "-i", file, "-frames:v", "1", ...scale, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]);
  const across = width ?? stream(file).width;
  const found: [number, number][] = [];
  for (let i = 0; i < raw.length; i += 3) {
    if (raw[i]! > 160 && raw[i + 1]! < 100) found.push([(i / 3) % across, Math.floor(i / 3 / across)]);
  }
  return found;
}

/** Where the red marker sits in one output frame, normalised. */
function markerAt(file: string, at: number): [number, number] | null {
  const found = redPixels(file, at, 480, 270);
  if (!found.length) return null;
  const mean = (i: 0 | 1) => found.reduce((sum, p) => sum + p[i], 0) / found.length;
  return [mean(0) / 480, mean(1) / 270];
}

function stream(file: string) {
  const out = spawnSync("ffprobe", [
    "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,nb_read_frames", "-of", "json", file,
  ], { encoding: "utf8" }).stdout;
  return JSON.parse(out).streams[0] as { width: number; height: number; nb_read_frames: string };
}

function run(...args: string[]) {
  const result = spawnSync("bun", [MAIN, "camera", ...args], { encoding: "utf8" });
  return { code: result.status, json: JSON.parse(result.stdout) };
}

describe("arguments", () => {
  test("usage errors exit 2 with one JSON object", async () => {
    const camera = (...args: string[]) => runArgv(["camera", ...args], fakeContext());
    expect(await camera()).toMatchObject({ code: 2, ok: false, command: "camera" });
    expect(await camera("--keys", "0:1", "--shot", "x.json")).toMatchObject({ code: 2 });
    expect(await camera("--keys", "nope", "--input", "x.mp4", "--explain")).toMatchObject({ code: 2 });
    expect(await camera("--keys", "0:1", "--wat")).toMatchObject({ code: 2 });
  });

  test("the frame rate comes from the stamps", () => {
    const frames = path("frames");
    spawnSync("mkdir", ["-p", frames]);
    for (let i = 0; i < 20; i++) writeFileSync(join(frames, `${1_700_000_000_000 + i * 16}.png`), "");
    expect(frameRate(frames)).toBeCloseTo(62.5, 1);
  });
});

describe.skipIf(!HAS_FFMPEG)("render", () => {
  test("every window shape renders 1080p", () => {
    for (const size of [[2560, 1600], [2880, 1200], [1600, 2400], [1280, 800]] as [number, number][]) {
      const take = path(`take-${size[0]}x${size[1]}.mp4`);
      makeTake(take, size, [0.5, 0.5], 2);
      for (const fit of ["pad", "crop"]) {
        const out = path(`out-${size[0]}-${fit}.mp4`);
        const { code, json } = run("--input", take, "--out", out, "--fit", fit, "--keys", "0:1.0", "1.5:1.3");
        expect(code).toBe(0);
        expect(json.ok).toBe(true);
        const info = stream(out);
        expect([info.width, info.height]).toEqual([1920, 1080]);
        expect(Number(info.nb_read_frames)).toBe(60);
      }
    }
  }, 120_000);

  test("a push-in lands on the named point", () => {
    const take = path("marker.mp4");
    makeTake(take, [2560, 1600], [0.6, 0.55]);
    for (const fit of ["pad", "crop"]) {
      const out = path(`push-${fit}.mp4`);
      run("--input", take, "--out", out, "--fit", fit, "--keys", "0:1.0:0.6:0.55", "1.5:1.3:0.6:0.55");
      const [x, y] = markerAt(out, 2.5)!;
      expect(Math.abs(x - 0.5)).toBeLessThan(0.02);
      expect(Math.abs(y - 0.5)).toBeLessThan(0.02);
    }
  }, 60_000);

  test("the zoom actually moves", () => {
    const take = path("centre.mp4");
    makeTake(take, [2560, 1600], [0.5, 0.5]);
    const out = path("zoom.mp4");
    run("--input", take, "--out", out, "--keys", "0:1.0", "2:1.33");
    expect(redPixels(out, 2.8).length).toBeGreaterThan(redPixels(out, 0.05).length * 1.4);
  }, 60_000);

  test("portrait output", () => {
    const take = path("short.mp4");
    makeTake(take, [2560, 1600], [0.5, 0.5], 1);
    const out = path("story.mp4");
    const { json } = run("--input", take, "--out", out, "--aspect", "9:16", "--keys", "0:1.0", "0.8:1.5");
    expect(json.output).toEqual([1080, 1920]);
    const info = stream(out);
    expect([info.width, info.height]).toEqual([1080, 1920]);
  }, 60_000);

  test("a shot lands on the rect, and explains itself first", () => {
    makeTake(path("take.mp4"), [2560, 1600], [0.6, 0.55]);
    const shot = path("shot.json");
    writeFileSync(shot, JSON.stringify({
      source: "take.mp4", out: "shot.mp4", beats: [
        { move: "hold", for: 0.4 },
        { move: "focus", rect: [0.55, 0.5, 0.1, 0.1], fill: 0.2, for: 1.2 },
      ],
    }));
    expect(run("--shot", shot, "--explain").json.keys.length).toBe(3);
    const { json } = run("--shot", shot, "--strip", path("strip.jpg"));
    expect(existsSync(json.out)).toBe(true);
    expect(existsSync(path("strip.jpg"))).toBe(true);
    const [x, y] = markerAt(json.out, 2.5)!;
    expect(Math.abs(x - 0.5)).toBeLessThan(0.02);
    expect(Math.abs(y - 0.5)).toBeLessThan(0.02);
  }, 60_000);

  test("start trims the take", () => {
    const take = path("trim.mp4");
    makeTake(take, [2560, 1600], [0.5, 0.5], 3);
    const out = path("start.mp4");
    run("--input", take, "--out", out, "--start", "1", "--keys", "0:1.0", "1:1.2");
    expect(Number(stream(out).nb_read_frames)).toBe(60);
  }, 60_000);
});
