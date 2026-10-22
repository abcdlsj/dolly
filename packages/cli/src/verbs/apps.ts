// Accessibility, windows and app lifecycle: the verbs an agent explores an
// app with before it films it.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { frameOf, pickWindow, placeControls, UsageError, type ScreenPoint } from "@dolly/core";
import { Code, type Window } from "@dolly/protocol";
import { requirePoint } from "../args.ts";
import type { Context } from "../context.ts";
import { Failure } from "../failure.ts";
import { guardFront, parseGuard, requireTrust } from "../guards.ts";
import { resolveFile, stateDir } from "../paths.ts";
import { verb } from "../verb.ts";

export async function windowFor(ctx: Context, pid: number): Promise<Window> {
  const { windows } = await ctx.driver.call("windows", { pid, layer: 0 });
  const window = pickWindow(windows, pid);
  if (!window) throw new Failure(`no window for pid ${pid}`);
  return window;
}

export async function windowById(ctx: Context, id: number): Promise<Window> {
  const { windows } = await ctx.driver.call("windows", { layer: null });
  const window = windows.find((w) => w.id === id);
  if (!window) throw new Failure(`no window ${id}`);
  return window;
}

export const press = verb({
  name: "press",
  summary: "press a control through accessibility, by its label",
  usage: "dolly press <pid> <label> [--guard app]",
  parse: (args) => ({
    pid: args.positionalNumber(0, "a pid"),
    label: args.positionalString(1, "a label"),
    ...parseGuard(args),
  }),
  async run({ pid, label, guard }, ctx) {
    await requireTrust(ctx);
    await guardFront(ctx, guard);
    const { pressed } = await ctx.driver.call("press", { pid, label });
    return { pid, label, pressed };
  },
  log: ({ pid, label }) => ({ pid, label }),
});

export const find = verb({
  name: "find",
  summary: "list controls whose label matches, to aim a press",
  usage: "dolly find <pid> <label>",
  parse: (args) => ({ pid: args.positionalNumber(0, "a pid"), label: args.positionalString(1, "a label") }),
  async run({ pid, label }, ctx) {
    const { matches } = await ctx.driver.call("find", { pid, label });
    return { count: matches.length, matches };
  },
});

export const controls = verb({
  name: "controls",
  summary: "list controls by role, to aim a press",
  usage: "dolly controls <pid> [--role AXButton]",
  parse: (args) => ({ pid: args.positionalNumber(0, "a pid"), role: args.string("role") ?? "AXButton" }),
  async run({ pid, role }, ctx) {
    const { controls } = await ctx.driver.call("controls", { pid, role });
    return { role, count: controls.length, controls };
  },
});

export const tree = verb({
  name: "tree",
  summary: "list a window's controls with screen frames, centres and shot-file rects",
  usage: "dolly tree <pid> [--window id] [--depth 40] [--limit 600] [--menus]",
  parse: (args) => ({
    pid: args.positionalNumber(0, "a pid"),
    window: args.number("window"),
    depth: args.number("depth", 40),
    limit: args.number("limit", 600),
    menus: args.flag("menus"),
  }),
  async run({ pid, window: id, depth, limit, menus }, ctx) {
    await requireTrust(ctx);
    const window = id === undefined ? await windowFor(ctx, pid) : await windowById(ctx, id);
    if (window.pid !== pid) throw new Failure(`window ${window.id} belongs to pid ${window.pid}, not ${pid}`);
    if (window.width <= 0 || window.height <= 0) throw new Failure(`window ${window.id} has no size`);
    const frame = frameOf(window);
    const { nodes, truncated } = await ctx.driver.call("tree", { pid, within: [...frame], depth, limit, menus });
    return { pid, window, count: nodes.length, truncated, nodes: placeControls(nodes, frame) };
  },
});

export const focus = verb({
  name: "focus",
  summary: "bring an app to the front before typing into it",
  usage: "dolly focus <pid> [--settle 0.2]",
  parse: (args) => ({ pid: args.positionalNumber(0, "a pid"), settle: args.number("settle", 0.2) }),
  async run({ pid, settle }, ctx) {
    await requireTrust(ctx);
    await ctx.driver.call("activate", { pid });
    await ctx.sleep(settle * 1000);
    const front = await ctx.driver.call("front", {}).catch(() => null);
    return { pid, front: front?.pid ?? 0, name: front?.name ?? "" };
  },
});

export const place = verb({
  name: "place",
  summary: "move an app's window to a screen point",
  usage: "dolly place <pid> <x,y>",
  parse: (args) => ({ pid: args.positionalNumber(0, "a pid"), at: args.positionalPoint(1) }),
  async run({ pid, at }, ctx) {
    await requireTrust(ctx);
    await ctx.driver.call("place", { pid, x: at.x, y: at.y });
    await ctx.sleep(300);
    return { pid, x: at.x, y: at.y };
  },
});

export const resize = verb({
  name: "resize",
  summary: "resize an app's window",
  usage: "dolly resize <pid> <width> <height>",
  parse: (args) => ({
    pid: args.positionalNumber(0, "a pid"),
    width: args.positionalNumber(1, "a width"),
    height: args.positionalNumber(2, "a height"),
  }),
  async run({ pid, width, height }, ctx) {
    await requireTrust(ctx);
    await ctx.driver.call("resize", { pid, width, height });
    await ctx.sleep(300);
    return { pid, width, height };
  },
});

/**
 * A profile folder that stands in for the user's home, so an app started
 * with it keeps its settings, caches and documents there and leaves the
 * user's own copy untouched.
 */
export function isolatedEnvironment(directory: string, platform = process.platform): Record<string, string> {
  if (platform === "win32") {
    return {
      USERPROFILE: directory,
      APPDATA: join(directory, "AppData", "Roaming"),
      LOCALAPPDATA: join(directory, "AppData", "Local"),
      TEMP: join(directory, "tmp"),
      TMP: join(directory, "tmp"),
    };
  }
  return {
    HOME: directory,
    TMPDIR: join(directory, "tmp") + "/",
    XDG_CONFIG_HOME: join(directory, ".config"),
    XDG_DATA_HOME: join(directory, ".local", "share"),
    XDG_CACHE_HOME: join(directory, ".cache"),
  };
}

function prepareProfile(directory: string, environment: Record<string, string>) {
  const folders = [
    ...Object.values(environment),
    join(directory, "Library", "Application Support"),
    join(directory, "Library", "Caches"),
    join(directory, "Library", "Preferences"),
  ];
  for (const folder of folders) mkdirSync(folder, { recursive: true });
}

export const launch = verb({
  name: "launch",
  summary: "start an app (optionally an isolated copy) and wait for its window",
  usage: "dolly launch <app path|bundle id|name> [--isolated [dir]] [--arg x]... [--size w,h] [--at x,y] [--wait 20]",
  parse(args) {
    const isolated = args.string("isolated");
    return {
      app: args.positionalString(0, "an app"),
      isolated: isolated === undefined ? undefined : isolated === "true" ? true : isolated,
      args: args.all("arg"),
      size: args.point("size"),
      at: args.point("at"),
      wait: args.number("wait", 20),
    } as { app: string; isolated?: true | string; args: string[]; size?: ScreenPoint; at?: ScreenPoint; wait: number };
  },
  async run(p, ctx) {
    const app = /[/\\]/.test(p.app) ? resolveFile(p.app, ctx.cwd) : p.app;
    let profile: string | undefined;
    let environment: Record<string, string> = {};
    if (p.isolated !== undefined) {
      const name = p.app.replace(/\.app$/, "").split(/[/\\]/).pop()!.replace(/[^\w.-]+/g, "-");
      profile = p.isolated === true ? join(stateDir(), "profiles", `${name}-${Math.trunc(ctx.now() / 1000)}`) : resolveFile(p.isolated, ctx.cwd);
      environment = isolatedEnvironment(profile);
      prepareProfile(profile, environment);
    }
    const launched = await ctx.driver.call("launch", { app, args: p.args, environment, fresh: profile !== undefined });

    const deadline = ctx.now() + p.wait * 1000;
    let window: Window | null = null;
    for (;;) {
      const { windows } = await ctx.driver.call("windows", { pid: launched.pid, layer: 0 });
      window = pickWindow(windows, launched.pid);
      if (window || ctx.now() >= deadline) break;
      await ctx.sleep(250);
    }
    if (window && (p.size || p.at)) {
      const { trusted } = await ctx.driver.call("trust", {});
      if (trusted) {
        if (p.size) await ctx.driver.call("resize", { pid: launched.pid, width: p.size.x, height: p.size.y });
        if (p.at) await ctx.driver.call("place", { pid: launched.pid, x: p.at.x, y: p.at.y });
        await ctx.sleep(300);
        window = pickWindow((await ctx.driver.call("windows", { pid: launched.pid, layer: 0 })).windows, launched.pid);
      }
    }

    const result: Record<string, unknown> = {
      pid: launched.pid,
      app: launched.app,
      bundle: launched.bundle,
      ready: window !== null,
    };
    if (window) result.window = window;
    if (profile) {
      result.profile = profile;
      if (launched.sandboxed) {
        result.warning = "sandboxed app: its container is not moved by --isolated, so it shares data with the user's copy";
      }
    }
    return result;
  },
});

export const quit = verb({
  name: "quit",
  summary: "quit an app, e.g. the isolated copy a shoot started",
  usage: "dolly quit <pid> [--force] [--wait 5]",
  parse: (args) => ({ pid: args.positionalNumber(0, "a pid"), force: args.flag("force"), wait: args.number("wait", 5) }),
  async run({ pid, force, wait }, ctx) {
    const { running } = await ctx.driver.call("quit", { pid, force, wait });
    return { pid, running, forced: force };
  },
});

export function requireWindowOrPid(window: number | undefined, pid: number | undefined): void {
  if (window === undefined && pid === undefined) throw new UsageError("expected a window id or --pid");
  if (window !== undefined && pid !== undefined) throw new Failure("pass a window id or --pid, not both", Code.usage);
}
