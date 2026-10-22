// Recording: frames for a camera move, video, and single looks at a window.

import { frameOf } from "@dolly/core";
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
