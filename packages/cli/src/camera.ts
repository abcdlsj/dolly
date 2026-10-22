#!/usr/bin/env bun
// Eased camera moves over a window recording; the TS successor of scripts/camera.py.
//
//   dolly-camera --input take.mp4 --out push-in.mp4 \
//       --keys 0:1.0:0.5:0.5 0.4:1.0:0.5:0.5 2.6:1.28:0.18:0.34 --strip strip.jpg
//   dolly-camera --shot shot.json --out film.mp4
//   dolly-camera --shot shot.json --explain     # keyframes and warnings, no render
//
// Planning lives in @dolly/core; this file only reads files and runs ffmpeg.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import {
  buildFilter,
  parseAspect,
  parseKeyframe,
  ShotError,
  shotFor,
  UsageError,
  type BeatSpec,
  type Fit,
  type Key,
  type Size,
} from "@dolly/core";

const FLAGS = ["input", "out", "shot", "start", "duration", "fit", "aspect", "fps", "crf", "strip"] as const;
const SWITCHES = ["frames", "explain", "dry-run"] as const;

interface Args {
  values: Partial<Record<(typeof FLAGS)[number], string>>;
  switches: Set<(typeof SWITCHES)[number]>;
  keys: string[] | null;
}

export const USAGE = `dolly-camera (--keys t:zoom[:x:y[:ease]] … | --shot file.json|-) [--input clip|dir] [--out file]
  [--frames] [--start s] [--duration s] [--fit pad|crop] [--aspect 16:9] [--fps n] [--crf n]
  [--strip file.jpg] [--explain] [--dry-run]`;

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { values: {}, switches: new Set(), keys: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const name = arg.startsWith("--") ? arg.slice(2) : null;
    if (name === "keys") {
      args.keys = [];
      while (i + 1 < argv.length && !argv[i + 1]!.startsWith("--")) args.keys.push(argv[++i]!);
      if (!args.keys.length) throw new UsageError("--keys needs at least one keyframe");
    } else if (name && (SWITCHES as readonly string[]).includes(name)) {
      args.switches.add(name as (typeof SWITCHES)[number]);
    } else if (name && (FLAGS as readonly string[]).includes(name)) {
      const value = argv[++i];
      if (value === undefined) throw new UsageError(`--${name} needs a value`);
      args.values[name as (typeof FLAGS)[number]] = value;
    } else {
      throw new UsageError(`unknown argument ${JSON.stringify(arg)}\n${USAGE}`);
    }
  }
  if ((args.keys === null) === (args.values.shot === undefined)) throw new UsageError("pass exactly one of --keys or --shot");
  return args;
}

interface ShotFile {
  source?: string;
  out?: string;
  frames?: boolean;
  start?: number;
  duration?: number;
  beats?: BeatSpec[];
  output?: { fit?: Fit; aspect?: string; crf?: number };
}

class Failure extends Error {
  constructor(message: string, readonly code = 5) {
    super(message);
  }
}

function run(command: string, args: readonly string[]): string {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 << 20 });
  if (result.error) throw new Failure(`${command} not found`);
  if (result.status !== 0) throw new Failure(`${command} failed: ${result.stderr.trim().slice(-400)}`);
  return result.stdout;
}

function probe(path: string): { size: Size; length: number } {
  const data = JSON.parse(
    run("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height:format=duration", "-of", "json", path,
    ]),
  );
  const stream = data.streams[0];
  return { size: [Number(stream.width), Number(stream.height)], length: Number(data.format?.duration ?? 0) };
}

export function frameStamps(directory: string): number[] {
  return readdirSync(directory)
    .filter((name) => extname(name) === ".png" && /^\d+$/.test(name.slice(0, -4)))
    .map((name) => Number(name.slice(0, -4)))
    .sort((a, b) => a - b);
}

/**
 * The capture rate a frame directory actually has. Frames are named by
 * millisecond stamp, so the median gap is the real interval: assuming a fixed
 * rate would retime takes captured faster or slower than it.
 */
export function frameRate(directory: string): number {
  const stamps = frameStamps(directory);
  if (stamps.length < 2) return 30;
  const gaps = stamps.slice(1).map((s, i) => s - stamps[i]!).filter((g) => g > 0).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return median ? 1000 / median : 30;
}

export function main(argv: readonly string[]): { code: number; output: unknown } {
  try {
    return { code: 0, output: camera(parseArgs(argv)) };
  } catch (error) {
    const code = error instanceof UsageError || error instanceof ShotError ? 2 : error instanceof Failure ? error.code : 5;
    const prefix = error instanceof ShotError ? "bad shot: " : "";
    return { code, output: { ok: false, error: prefix + (error as Error).message } };
  }
}

function camera(args: Args): unknown {
  const { values, switches } = args;
  let shotFile: ShotFile = {};
  let base = process.cwd();
  if (values.shot !== undefined) {
    try {
      const text = values.shot === "-" ? readFileSync(0, "utf8") : readFileSync(values.shot, "utf8");
      shotFile = JSON.parse(text);
      if (values.shot !== "-") base = dirname(resolve(values.shot));
    } catch (error) {
      throw new UsageError(`cannot read shot: ${(error as Error).message}`);
    }
  }
  const output = shotFile.output ?? {};
  const fromShot = (value: unknown) => (typeof value === "string" ? join(base, value) : undefined);

  const sourcePath = values.input ?? fromShot(shotFile.source);
  const outPath = values.out ?? fromShot(shotFile.out);
  const frames = switches.has("frames") || Boolean(shotFile.frames);
  const start = values.start !== undefined ? Number(values.start) : Number(shotFile.start ?? 0);
  const duration = values.duration !== undefined ? Number(values.duration) : (shotFile.duration ?? null);
  const fit = (values.fit ?? output.fit ?? "pad") as Fit;
  const crf = values.crf !== undefined ? Number(values.crf) : Number(output.crf ?? 16);
  const out = parseAspect(values.aspect ?? String(output.aspect ?? "16:9"));
  if (fit !== "pad" && fit !== "crop") throw new UsageError(`bad fit ${JSON.stringify(fit)}, want pad or crop`);
  if (!sourcePath) throw new UsageError("no input: pass --input or give the shot a `source`");
  const dry = switches.has("explain") || switches.has("dry-run");
  if (!outPath && !dry) throw new UsageError("no output: pass --out or give the shot an `out`");
  const keys: Key[] | undefined = args.keys?.map(parseKeyframe);

  let source: Size;
  let takeLength: number;
  let fps = 0;
  if (frames) {
    const stamps = frameStamps(sourcePath);
    if (!stamps.length) throw new Failure(`no timestamped PNG frames in ${sourcePath}`);
    source = probe(join(sourcePath, `${stamps[0]}.png`)).size;
    fps = values.fps !== undefined ? Number(values.fps) : frameRate(sourcePath);
    takeLength = stamps.length / (fps || 30);
  } else {
    ({ size: source, length: takeLength } = probe(sourcePath));
    if (values.fps !== undefined) fps = Number(values.fps);
  }
  const length = duration ? Number(duration) : Math.max(takeLength - start, 0) || null;

  const shot = shotFor({ source, fit, length, ...(keys ? { keys } : { beats: shotFile.beats ?? [] }) }, out);
  if (switches.has("explain")) return shot.explain();

  const graph = buildFilter(shot.keys, source, start, duration ? Number(duration) : null, shot.ceiling, fit, out);
  if (switches.has("dry-run")) return { ok: true, filter: graph };

  const input = frames
    ? ["-framerate", (fps || 30).toFixed(3), "-pattern_type", "glob", "-i", join(sourcePath, "*.png")]
    : ["-i", sourcePath];
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y", ...input, "-vf", graph,
    "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-crf", String(crf), "-preset", "slow", "-r", "30", outPath!,
  ]);

  let strip: string | null = null;
  if (values.strip) {
    const stripLength = length || probe(outPath!).length || 1;
    strip = values.strip;
    run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y", "-i", outPath!,
      "-vf", `fps=5/${Math.max(stripLength, 0.1).toFixed(3)},scale=480:-1,tile=5x1`, "-frames:v", "1", strip,
    ]);
  }

  return {
    ok: true,
    source,
    output: out,
    ceiling: shot.ceiling,
    upscaled: shot.upscaled,
    zoom: shot.zooms,
    clamped: shot.clamped,
    out: outPath,
    fit,
    fps: fps ? Math.round(fps * 100) / 100 : null,
    strip,
    warnings: shot.warnings,
  };
}

if (import.meta.main) {
  const { code, output } = main(process.argv.slice(2));
  console.log(JSON.stringify(output));
  process.exit(code);
}
