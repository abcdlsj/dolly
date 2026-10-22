// Pointer and keyboard verbs: plan a timeline in core, let the driver play it.

import {
  after,
  clickSteps,
  dragSteps,
  end,
  isPointerEase,
  keySteps,
  moveSteps,
  nudgeSteps,
  scrollSteps,
  UsageError,
  type PointerEase,
  type ScreenPoint,
} from "@dolly/core";
import type { Button, InputStep, Modifier } from "@dolly/protocol";
import { requirePoint, type Args } from "../args.ts";
import type { Context } from "../context.ts";
import { guardFront, guardOwner, parseGuard, requireTrust, type Guarded } from "../guards.ts";
import { verb } from "../verb.ts";

interface Travel extends Guarded {
  /** Travel time in ms. */
  ms?: number;
  ease?: PointerEase;
}

function parseTravel(args: Args, fallbackMs = 700): Required<Pick<Travel, "ms" | "ease">> & Guarded {
  const ease = args.string("ease") ?? "inOut";
  if (!isPointerEase(ease)) throw new UsageError(`bad ease ${JSON.stringify(ease)}, want inOut, out, inQuint or linear`);
  return { ms: Math.max(args.number("ms", fallbackMs), 0), ease, ...parseGuard(args) };
}

const BUTTONS: Record<string, Button> = { left: "left", right: "right", middle: "middle", center: "middle" };
const MODIFIERS: Record<string, Modifier> = {
  cmd: "cmd", command: "cmd", shift: "shift", alt: "alt", option: "alt", opt: "alt", ctrl: "ctrl", control: "ctrl",
};

function parseButton(args: Args): Button {
  const name = args.string("button") ?? "left";
  const button = BUTTONS[name];
  if (!button) throw new UsageError(`bad button ${JSON.stringify(name)}, want left, right or middle`);
  return button;
}

function parseModifiers(args: Args): Modifier[] {
  return args.strings("modifiers").map((name) => {
    const modifier = MODIFIERS[name.toLowerCase()];
    if (!modifier) throw new UsageError(`bad modifier ${JSON.stringify(name)}, want cmd, shift, alt or ctrl`);
    return modifier;
  });
}

async function prepare(ctx: Context, guard: string[] | undefined): Promise<void> {
  await requireTrust(ctx);
  await guardFront(ctx, guard);
}

async function play(ctx: Context, steps: InputStep[]): Promise<number> {
  const started = ctx.now();
  if (steps.length) await ctx.driver.call("input", { steps });
  return ctx.now() - started;
}

/** Travels from wherever the pointer is now, and returns the elapsed ms. */
async function travelTo(ctx: Context, path: ScreenPoint[], ms: number, ease: PointerEase): Promise<number> {
  const from = await ctx.driver.call("pointer", {});
  return play(ctx, moveSteps(from, path, ms, ease));
}

const points = (path: ScreenPoint[]) => path.map(({ x, y }) => ({ x, y }));
const last = (path: ScreenPoint[]) => path[path.length - 1]!;

export const move = verb({
  name: "move",
  summary: "move the pointer to a point",
  usage: "dolly move <x,y> [--ms 700] [--ease inOut] [--guard app]",
  parse: (args) => ({ to: args.positionalPoint(0), ...parseTravel(args) }),
  async run({ to, ms, ease, guard }, ctx) {
    await prepare(ctx, guard);
    return { to: points([to]), ms: await travelTo(ctx, [to], ms, ease) };
  },
  log: ({ to }) => ({ to }),
});

export const path = verb({
  name: "path",
  summary: "move through several points in one eased travel",
  usage: "dolly path <x,y> <x,y> ... [--ms 700] [--guard app]",
  parse(args) {
    if (!args.positional.length) throw new UsageError("expected points as x,y");
    return { points: args.positional.map(requirePoint), ...parseTravel(args) };
  },
  async run({ points: through, ms, ease, guard }, ctx) {
    await prepare(ctx, guard);
    return { to: points(through), ms: await travelTo(ctx, through, ms, ease) };
  },
  log: ({ points: through }) => ({ to: last(through) }),
});

export const hover = verb({
  name: "hover",
  summary: "move to a point and hold, so hover state settles",
  usage: "dolly hover <x,y> [--hold 1.2] [--nudge 0] [--ms 700] [--guard app]",
  parse: (args) => ({
    to: args.positionalPoint(0),
    hold: args.number("hold", 1.2),
    nudge: args.number("nudge", 0),
    ...parseTravel(args),
  }),
  async run({ to, hold, nudge, ms, ease, guard }, ctx) {
    await prepare(ctx, guard);
    const from = await ctx.driver.call("pointer", {});
    const steps = moveSteps(from, [to], ms, ease);
    const elapsed = await play(ctx, [...steps, ...after(end(steps) + 8, nudgeSteps(to, nudge))]);
    await ctx.sleep(hold * 1000);
    return { to: points([to]), ms: elapsed, held: hold };
  },
  log: ({ to }) => ({ to }),
});

export const click = verb({
  name: "click",
  summary: "move to a point, press and release",
  usage: "dolly click <x,y> [--button left|right|middle] [--count 1] [--modifiers cmd,shift] [--hold 0] [--ms 700] [--guard app]",
  parse: (args) => ({
    to: args.positionalPoint(0),
    button: parseButton(args),
    count: Math.max(args.number("count", 1), 1),
    modifiers: parseModifiers(args),
    hold: args.number("hold", 0),
    ...parseTravel(args),
  }),
  async run({ to, button, count, modifiers, hold, ms, ease, guard }, ctx) {
    await prepare(ctx, guard);
    const from = await ctx.driver.call("pointer", {});
    const travel = moveSteps(from, [to], ms, ease);
    const elapsed = await play(ctx, [...travel, ...after(end(travel), clickSteps({ button, count, modifiers }))]);
    await ctx.sleep(hold * 1000);
    return { to: points([to]), ms: elapsed, clicks: count };
  },
  log: ({ to }) => ({ to }),
});

export const drag = verb({
  name: "drag",
  summary: "press, travel while held, release (starts real drag sessions)",
  usage:
    "dolly drag <x,y> <x,y> [--via x,y]... [--ms 900] [--hold 0.6] [--press-hold 0.25] [--settle 0.2] [--approach-ms 450] [--owner pid] [--guard app]",
  parse(args) {
    const from = args.positionalPoint(0);
    // `drag 1,2 3,4` or `drag 1 2 3 4`.
    const to = args.positional.length >= 4 && !args.positional[0]!.includes(",") ? args.positionalPoint(2) : args.positionalPoint(1);
    return {
      from,
      to,
      via: args.all("via").map(requirePoint),
      hold: args.number("hold", 0.6),
      pressHold: args.number("press-hold", 0.25),
      settle: args.number("settle", 0.2),
      approachMs: args.number("approach-ms", 450),
      owner: args.number("owner"),
      ...parseTravel(args, 900),
    };
  },
  async run(p, ctx) {
    await prepare(ctx, p.guard);
    await travelTo(ctx, [p.from], p.approachMs, "inOut");
    await guardOwner(ctx, p.owner);
    await play(
      ctx,
      dragSteps(p.from, p.to, {
        via: p.via,
        ms: p.ms,
        ease: p.ease,
        settle: p.settle * 1000,
        pressHold: p.pressHold * 1000,
        hold: p.hold * 1000,
      }),
    );
    return { from: { x: p.from.x, y: p.from.y }, to: { x: p.to.x, y: p.to.y }, ms: p.ms, held: p.hold };
  },
  log: ({ to }) => ({ to }),
});

export const scroll = verb({
  name: "scroll",
  summary: "scroll the wheel at the current pointer position",
  usage: "dolly scroll <dy> [dx] [--unit line|pixel] [--times 1] [--interval 0.05] [--guard app]",
  parse(args) {
    const unit = args.string("unit") ?? "line";
    if (unit !== "line" && unit !== "pixel") throw new UsageError("--unit wants line or pixel");
    return {
      dy: Math.trunc(args.positional[0] === undefined ? 0 : args.positionalNumber(0, "a scroll amount")),
      dx: Math.trunc(args.positional[1] === undefined ? 0 : args.positionalNumber(1, "a horizontal amount")),
      unit: unit as "line" | "pixel",
      times: Math.max(args.number("times", 1), 1),
      interval: args.number("interval", 0.05),
      ...parseGuard(args),
    };
  },
  async run({ dy, dx, unit, times, interval, guard }, ctx) {
    await prepare(ctx, guard);
    await play(ctx, scrollSteps(dy, dx, unit, times, interval * 1000));
    return { dy, dx, times };
  },
  log: () => ({}),
});

export const key = verb({
  name: "key",
  summary: "press a virtual key code",
  usage: "dolly key <code> [--modifiers cmd,shift,alt,ctrl] [--guard app]",
  parse: (args) => ({ code: args.positionalNumber(0, "a virtual key code"), modifiers: parseModifiers(args), ...parseGuard(args) }),
  async run({ code, modifiers, guard }, ctx) {
    await prepare(ctx, guard);
    await play(ctx, keySteps(code, modifiers));
    return { key: code };
  },
  log: ({ code }) => ({ key: code }),
});

export const type = verb({
  name: "type",
  summary: "type text into the focused control",
  usage: "dolly type <text> [--guard app]",
  parse: (args) => ({ text: args.positional.join(" "), ...parseGuard(args) }),
  async run({ text, guard }, ctx) {
    await prepare(ctx, guard);
    await play(ctx, [{ ms: 0, type: "text", text }]);
    return { characters: [...text].length };
  },
  log: ({ text }) => ({ characters: [...text].length }),
});

/** Virtual key codes of the modifier keys, left side (macOS numbering, which drivers translate). */
const MODIFIER_KEYS = { cmd: 55, shift: 56, alt: 58, ctrl: 59 } as const;

export const release = verb({
  name: "release",
  summary: "lift every mouse button and modifier key, e.g. after a take is stopped mid-drag",
  usage: "dolly release",
  parse: () => ({}),
  async run(_, ctx) {
    await requireTrust(ctx);
    const buttons: Button[] = ["left", "right", "middle"];
    const steps: InputStep[] = [
      ...buttons.map((button) => ({ ms: 0, type: "up" as const, button, clicks: 1, modifiers: [] })),
      ...Object.values(MODIFIER_KEYS).map((code) => ({ ms: 0, type: "key" as const, code, down: false, modifiers: [] })),
    ];
    await play(ctx, steps);
    return { released: [...buttons, ...Object.keys(MODIFIER_KEYS)] };
  },
});
