// Recording: frames for a camera move, video, and single looks at a window.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { frameOf, scrollSteps, UsageError } from "@dolly/core";
import { guardFront, parseGuard, requireTrust } from "../guards.ts";
import { verb } from "../verb.ts";
import { resolveFile } from "../paths.ts";
import { requireWindowOrPid, windowById, windowFor } from "./apps.ts";

export const record = verb({
  name: "record",
  summary: "capture window-only PNG frames for a camera move",
  usage: "dolly record <windowID> <dir> <seconds> [--loops 4]",
  parse: (args) => ({
    window: args.positionalNumber(0, "a window id"),
    directory: args.positionalString(1, "a directory"),
    seconds: args.positionalNumber(2, "a duration"),
    loops: args.number("loops", 4),
  }),
  async run(p, ctx) {
    const window = await windowById(ctx, p.window);
    const directory = resolveFile(p.directory, ctx.cwd);
    const result = await ctx.driver.call("frames", { window: p.window, directory, seconds: p.seconds, loops: p.loops });
    return {
      window: p.window,
      directory,
      frames: result.frames,
      seconds: result.seconds,
      started: result.started,
      fps: result.seconds > 0 ? Math.round((result.frames / result.seconds) * 10) / 10 : 0,
      frame: frameOf(window),
    };
  },
  log: (_, result) => ({ t: result.started, window: result.window, directory: result.directory, frame: result.frame }),
});

export const capture = verb({
  name: "capture",
  summary: "record one window as video, at the display's frame rate",
  usage: "dolly capture <windowID> <out.mov> <seconds>",
  parse: (args) => ({
    window: args.positionalNumber(0, "a window id"),
    file: args.positionalString(1, "an output file"),
    seconds: args.positionalNumber(2, "a duration"),
  }),
  async run(p, ctx) {
    const window = await windowById(ctx, p.window);
    const file = resolveFile(p.file, ctx.cwd);
    const result = await ctx.driver.call("video", { window: p.window, file, seconds: p.seconds });
    return { window: p.window, file, started: result.started, pixels: result.pixels, frame: frameOf(window) };
  },
  log: (_, result) => ({ t: result.started, window: result.window, file: result.file, frame: result.frame }),
});

export const snap = verb({
  name: "snap",
  summary: "save one frame of a window as PNG, to look at it",
  usage: "dolly snap <windowID> <out.png> [--max 1600] | dolly snap --pid n <out.png>",
  parse(args) {
    const pid = args.number("pid");
    const window = pid === undefined ? args.positionalNumber(0, "a window id or --pid") : undefined;
    requireWindowOrPid(window, pid);
    return {
      window,
      pid,
      file: args.positionalString(pid === undefined ? 1 : 0, "an output file"),
      max: args.number("max", 1600),
    };
  },
  async run(p, ctx) {
    const window = p.pid !== undefined ? await windowFor(ctx, p.pid) : await windowById(ctx, p.window!);
    const file = resolveFile(p.file, ctx.cwd);
    // A model reads a smaller image just as well, for a fraction of the
    // tokens; `scale` keeps the way back to screen points exact.
    const { pixels } = await ctx.driver.call("still", { window: window.id, file, max: p.max });
    const scale = window.width > 0 ? Math.round((pixels[0] / window.width) * 10000) / 10000 : 0;
    return {
      window: window.id,
      pid: window.pid,
      file,
      frame: frameOf(window),
      pixels,
      scale,
      map: "screen x = frame.x + pixel x / scale; rect x = pixel x / pixels.width",
    };
  },
});

/** `x,y,width,height` in window points. */
function parseRect(text: string | undefined): [number, number, number, number] | undefined {
  if (text === undefined) return undefined;
  const parts = text.split(",").map(Number);
  if (parts.length !== 4 || parts.some(Number.isNaN) || parts[2]! <= 0 || parts[3]! <= 0) {
    throw new UsageError(`--crop wants x,y,width,height in window points, got ${JSON.stringify(text)}`);
  }
  return parts as [number, number, number, number];
}

export const scrollshot = verb({
  name: "scrollshot",
  summary: "scroll one view top to bottom and stitch it into one tall PNG",
  usage:
    "dolly scrollshot <windowID> <out.png> --crop x,y,w,h [--at x,y] [--step 6] [--max 60] [--retries 3] [--trim 24] [--settle 0.35] [--chrome] [--keep] [--guard app]",
  parse(args) {
    const crop = parseRect(args.string("crop"));
    if (!crop) throw new UsageError("--crop wants the scrolling view as x,y,width,height in window points");
    const trim = args.strings("trim").map(Number);
    if (trim.some(Number.isNaN)) throw new UsageError("--trim wants points, or top,bottom");
    return {
      window: args.positionalNumber(0, "a window id"),
      file: args.positionalString(1, "an output file"),
      crop,
      at: args.point("at"),
      step: Math.max(Math.trunc(args.number("step", 6)), 1),
      max: Math.max(Math.trunc(args.number("max", 60)), 1),
      retries: Math.max(Math.trunc(args.number("retries", 3)), 1),
      trim: [trim[0] ?? 24, trim[1] ?? trim[0] ?? 24] as [number, number],
      settle: args.number("settle", 0.35),
      chrome: args.flag("chrome"),
      keep: args.flag("keep"),
      ...parseGuard(args),
    };
  },
  async run(p, ctx) {
    await requireTrust(ctx);
    await guardFront(ctx, p.guard);
    const window = await windowById(ctx, p.window);
    const file = resolveFile(p.file, ctx.cwd);
    const [cx, cy, cw, ch] = p.crop;
    // Scroll where the view is, then park the pointer outside it for every
    // frame: a row hovered under a still pointer would light a different row
    // in each frame and stripe the result.
    const at = { x: window.x + (p.at?.x ?? cx + cw / 2), y: window.y + (p.at?.y ?? cy + ch / 2) };
    const park = { x: window.x + Math.min(cx + cw + 40, window.width - 4), y: at.y };
    const frames = mkdtempSync(join(tmpdir(), "dolly-scrollshot-"));
    const settle = () => ctx.sleep(p.settle * 1000);
    const pointTo = (point: { x: number; y: number }) =>
      ctx.driver.call("input", { steps: [{ ms: 0, type: "move", x: point.x, y: point.y }] });

    await pointTo(at);
    await ctx.driver.call("input", { steps: scrollSteps(100, 0, "line", 12, 20) });
    await pointTo(park);
    await settle();

    let scale = 0;
    let crop: [number, number, number, number] = [0, 0, 0, 0];
    const files: string[] = [];
    const shoot = async () => {
      const next = join(frames, `${String(files.length).padStart(3, "0")}.png`);
      const { pixels } = await ctx.driver.call("still", { window: window.id, file: next, max: 0 });
      if (!scale) {
        scale = window.width > 0 ? pixels[0] / window.width : 1;
        crop = [cx, cy, cw, ch].map((v) => Math.round(v * scale)) as typeof crop;
      }
      files.push(next);
    };
    const trim = (): [number, number] => [Math.round(p.trim[0] * scale), Math.round(p.trim[1] * scale)];

    await shoot();
    let reachedEnd = false;
    // A view can drop a wheel event that lands just as the pointer enters
    // it, so one step that does not move is not yet the end: only `retries`
    // still steps in a row are.
    let still = 0;
    while (files.length < p.max) {
      await pointTo(at);
      await ctx.sleep(80);
      await ctx.driver.call("input", { steps: scrollSteps(-p.step, 0, "line", 1, 0) });
      await pointTo(park);
      await settle();
      await shoot();
      const { offsets } = await ctx.driver.call("stitch", { files: files.slice(-2), crop, trim: trim() });
      if ((offsets[1] ?? 0) > 0) {
        still = 0;
        continue;
      }
      rmSync(files.pop()!, { force: true });
      if (++still >= p.retries) {
        reachedEnd = true;
        break;
      }
    }

    const result = await ctx.driver.call("stitch", { files, crop, trim: trim(), out: file, chrome: p.chrome });
    if (!p.keep) rmSync(frames, { recursive: true, force: true });
    return {
      window: window.id,
      file,
      pixels: result.pixels,
      frames: files.length,
      reachedEnd,
      offsets: result.offsets,
      ...(p.keep ? { kept: frames } : {}),
    };
  },
});
