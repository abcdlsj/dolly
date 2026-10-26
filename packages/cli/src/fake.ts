// A driver with no platform behind it: a scripted screen that records every
// call. Tests use it, and so can Studio while it runs in a browser.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { App, Control, Op, Params, Result, Window } from "@dolly/protocol";
import type { Context } from "./context.ts";
import type { Driver } from "./driver.ts";
import { EventLog } from "./eventlog.ts";
import { Failure } from "./failure.ts";

export interface FakeScreen {
  trusted: boolean;
  front: App;
  windows: Window[];
  pointer: { x: number; y: number };
  controls: Control[];
}

export const MARGIN: FakeScreen = {
  trusted: true,
  front: { pid: 4711, name: "Margin", bundle: "app.margin.notes" },
  windows: [
    { id: 61527, pid: 4711, layer: 0, x: 200, y: 120, width: 1280, height: 800, name: "Margin", onScreen: true },
    { id: 120, pid: 300, layer: 0, x: 0, y: 0, width: 1728, height: 1117, name: "Desktop", onScreen: true },
  ],
  pointer: { x: 10, y: 10 },
  controls: [
    { role: "AXButton", title: "New Note", actions: ["AXPress"], frame: [220, 160, 96, 28] },
    { role: "AXTextArea", value: "Groceries", frame: [520, 200, 900, 640], parent: 0 },
  ],
};

export class FakeDriver implements Driver {
  readonly calls: { op: Op; params: unknown }[] = [];
  /** How many times a scrollshot has measured a scroll. */
  scrolls = 0;
  screen: FakeScreen;

  constructor(screen: Partial<FakeScreen> = {}) {
    this.screen = structuredClone({ ...MARGIN, ...screen });
  }

  /** Calls of one op, in order. */
  of<O extends Op>(op: O): Params<O>[] {
    return this.calls.filter((c) => c.op === op).map((c) => c.params as Params<O>);
  }

  async call<O extends Op>(op: O, params: Params<O>): Promise<Result<O>> {
    this.calls.push({ op, params });
    return this.answer(op, params as never) as Result<O>;
  }

  private answer(op: Op, p: Record<string, any>): unknown {
    const s = this.screen;
    switch (op) {
      case "trust":
        return { trusted: s.trusted };
      case "front":
        return s.front;
      case "windows":
        return {
          windows: s.windows.filter((w) => (p.pid === undefined || w.pid === p.pid) && (p.layer == null || w.layer === p.layer)),
        };
      case "pointer":
        return s.pointer;
      case "input": {
        for (const step of p.steps) if (step.type === "move" || step.type === "drag") s.pointer = { x: step.x, y: step.y };
        return { posted: p.steps.length, dropped: 0, ms: p.steps.at(-1)?.ms ?? 0 };
      }
      case "find":
      case "press": {
        const label = String(p.label).toLowerCase();
        const matches = s.controls
          .filter((c) => [c.title, c.description, c.value, c.help].some((t) => t?.toLowerCase() === label))
          .map((c) => [c.role, c.title ?? c.description ?? ""].join(" "));
        if (op === "find") return { matches };
        if (!matches.length) throw new Failure(`no control matching "${p.label}"`);
        return { pressed: matches[0] };
      }
      case "controls":
        return { controls: s.controls.filter((c) => c.role === p.role).map((c) => `${c.role} ${c.title ?? ""}`) };
      case "tree":
        return { nodes: s.controls, truncated: false };
      case "activate":
        s.front = { ...s.front, pid: p.pid };
        return { front: s.front };
      case "place":
      case "resize":
        return {};
      case "video":
        return { started: 1_700_000_000_000, pixels: [2560, 1600] };
      case "frames":
        return { started: 1_700_000_000_000, frames: Math.round(p.seconds * 60), seconds: p.seconds };
      case "still":
        return { pixels: p.max ? [Math.min(p.max, 2560), Math.round((Math.min(p.max, 2560) * 1600) / 2560)] : [2560, 1600] };
      case "stitch": {
        // The fake view scrolls three times, then stops.
        const offsets = p.files.map((_: string, i: number) => (i === 0 ? 0 : this.scrolls < 3 ? 200 : 0));
        if (!p.out) this.scrolls++;
        return { offsets, costs: offsets.map(() => 0), ...(p.out ? { pixels: [600, 2000], used: p.files.length } : {}) };
      }
      case "launch":
        return { pid: 4711, app: `/Applications/${p.app}.app`, bundle: "app.margin.notes", sandboxed: false };
      case "quit":
        return { running: false };
    }
  }
}

/** A context on a fake driver, with a clock that only moves when something sleeps. */
export function fakeContext(driver = new FakeDriver(), overrides: Partial<Omit<Context, "driver">> = {}): Context & { driver: FakeDriver; slept: number[] } {
  let now = 1_700_000_000_000;
  const slept: number[] = [];
  return {
    cwd: "/tmp",
    now: () => now,
    sleep: async (ms) => {
      slept.push(ms);
      now += ms;
    },
    events: new EventLog(mkdtempSync(join(tmpdir(), "dolly-events-"))),
    env: {},
    slept,
    ...overrides,
    driver,
  };
}
