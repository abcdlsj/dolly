// Every verb against a fake driver: what reaches the platform, and what the CLI prints.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InputStep } from "@dolly/protocol";
import { call, DollyError } from "../src/client.ts";
import { FakeDriver, fakeContext } from "../src/fake.ts";
import { encode, run } from "../src/run.ts";

const steps = (driver: FakeDriver): InputStep[] => driver.of("input").flatMap((p) => p.steps);

describe("output", () => {
  test("help is one JSON object listing every verb", async () => {
    const out = await run(["help"], fakeContext());
    expect(out).toMatchObject({ ok: true, code: 0, command: "help" });
    expect(out.commands).toContain("launch");
    expect(String(out.text)).toContain("dolly tree <pid>");
  });

  test("an unknown verb is a usage error", async () => {
    expect(await run(["wiggle"], fakeContext())).toMatchObject({ ok: false, code: 2 });
  });

  test("keys are sorted on one line", () => {
    expect(encode({ ok: true, code: 0, command: "front", pid: 1 })).toBe('{"code":0,"command":"front","ok":true,"pid":1}');
  });
});

describe("pointer", () => {
  test("move travels from where the pointer is and lands exactly", async () => {
    const ctx = fakeContext();
    const out = await run(["move", "640,420", "--ms", "200"], ctx);
    expect(out).toMatchObject({ ok: true, to: [{ x: 640, y: 420 }] });
    const played = steps(ctx.driver);
    expect(played[0]).toEqual({ ms: 0, type: "move", x: 10, y: 10 });
    expect(played.at(-1)).toEqual({ ms: 200, type: "move", x: 640, y: 420 });
  });

  test("a guard refuses with exit 3 and posts nothing", async () => {
    const ctx = fakeContext();
    const out = await run(["click", "1,1", "--guard", "com.other.App"], ctx);
    expect(out).toMatchObject({ ok: false, code: 3 });
    expect(out.error).toContain("Margin");
    expect(ctx.driver.of("input")).toEqual([]);
    expect((await run(["click", "1,1", "--guard", "4711"], fakeContext())).ok).toBe(true);
    expect((await run(["click", "1,1", "--guard", "Margin"], fakeContext())).ok).toBe(true);
  });

  test("without Accessibility every input verb exits 4", async () => {
    for (const argv of [["move", "1,1"], ["type", "hi"], ["key", "36"], ["press", "4711", "New"]]) {
      const ctx = fakeContext(new FakeDriver({ trusted: false }));
      expect(await run(argv, ctx)).toMatchObject({ ok: false, code: 4 });
    }
  });

  test("a double click carries its click numbers and modifiers", async () => {
    const ctx = fakeContext();
    await run(["click", "100,100", "--count", "2", "--modifiers", "cmd,shift", "--ms", "0"], ctx);
    const presses = steps(ctx.driver).filter((s) => s.type === "down" || s.type === "up");
    expect(presses.map((s) => [s.type, "clicks" in s ? s.clicks : 0])).toEqual([["down", 1], ["up", 1], ["down", 2], ["up", 2]]);
    expect(presses.every((s) => "modifiers" in s && s.modifiers.join() === "cmd,shift")).toBe(true);
  });

  test("hover holds after arriving, and a nudge wiggles one point", async () => {
    const ctx = fakeContext();
    const out = await run(["hover", "50,50", "--hold", "1.4", "--nudge", "1", "--ms", "100"], ctx);
    expect(out.held).toBe(1.4);
    expect(ctx.slept).toContain(1400);
    expect(steps(ctx.driver).slice(-2).map((s) => ("x" in s ? s.x : 0))).toEqual([51, 50]);
  });

  test("drag approaches, then presses, crosses the threshold held, drops and releases", async () => {
    const ctx = fakeContext();
    await run(["drag", "300,64", "900,540", "--ms", "400", "--hold", "0.8"], ctx);
    const [approach, gesture] = ctx.driver.of("input").map((p) => p.steps);
    expect(approach!.every((s) => s.type === "move")).toBe(true);
    expect(approach!.at(-1)).toMatchObject({ x: 300, y: 64 });
    expect(gesture![0]).toMatchObject({ type: "down", ms: 200 });
    const last = gesture!.at(-1)!;
    const drop = gesture!.at(-2)!;
    expect(drop).toMatchObject({ type: "drag", x: 900, y: 540 });
    expect(last).toMatchObject({ type: "up", ms: drop.ms + 800 });
    expect(gesture!.filter((s) => s.type === "drag").length).toBeGreaterThan(50);
  });

  test("drag --owner refuses when another app's window is under the pointer", async () => {
    const ctx = fakeContext();
    // 100,100 is on the desktop window, not on Margin's.
    const out = await run(["drag", "100,100", "900,540", "--owner", "4711"], ctx);
    expect(out).toMatchObject({ ok: false, code: 3 });
    expect(ctx.driver.of("input").length).toBe(1);
    expect((await run(["drag", "300,200", "900,540", "--owner", "4711"], fakeContext())).ok).toBe(true);
  });

  test("scroll, key and type", async () => {
    const ctx = fakeContext();
    await run(["scroll", "-3", "--times", "2"], ctx);
    await run(["key", "36", "--modifiers", "cmd"], ctx);
    await run(["type", "hello", "world"], ctx);
    expect(steps(ctx.driver).map((s) => s.type)).toEqual(["scroll", "scroll", "key", "key", "text"]);
    expect(steps(ctx.driver)[0]).toMatchObject({ dy: -3, dx: 0, unit: "line" });
    expect(steps(ctx.driver).at(-1)).toMatchObject({ text: "hello world" });
  });

  test("release lifts every button and modifier without a guard", async () => {
    const ctx = fakeContext();
    expect(await run(["release"], ctx)).toMatchObject({ ok: true, released: ["left", "right", "middle", "cmd", "shift", "alt", "ctrl"] });
    expect(steps(ctx.driver).map((s) => s.type)).toEqual(["up", "up", "up", "key", "key", "key", "key"]);
    expect(steps(ctx.driver).every((s) => s.type !== "key" || !s.down)).toBe(true);
  });

  test("bad input is a usage error before anything is posted", async () => {
    for (const argv of [["move"], ["move", "a,b"], ["click", "1,1", "--button", "thumb"], ["click", "1,1", "--ease", "wobbly"], ["key", "enter"]]) {
      const ctx = fakeContext();
      expect(await run(argv, ctx)).toMatchObject({ ok: false, code: 2 });
      expect(ctx.driver.of("input")).toEqual([]);
    }
  });
});

describe("apps and windows", () => {
  test("tree places each control as a centre and a window rect", async () => {
    const out = await run(["tree", "4711"], fakeContext());
    expect(out).toMatchObject({ ok: true, count: 2, truncated: false });
    const [button] = out.nodes as { center: number[]; rect: number[]; i: number }[];
    expect(button!.center).toEqual([268, 174]);
    expect(button!.rect).toEqual([0.0156, 0.05, 0.075, 0.035]);
  });

  test("snap picks the app's window and reports the scale back to points", async () => {
    const ctx = fakeContext();
    const out = await run(["snap", "--pid", "4711", "shot.png"], ctx);
    expect(out).toMatchObject({ ok: true, window: 61527, file: "/tmp/shot.png", pixels: [1600, 1000], scale: 1.25 });
    expect(ctx.driver.of("still")[0]).toEqual({ window: 61527, file: "/tmp/shot.png", max: 1600 });
    expect(await run(["snap"], fakeContext())).toMatchObject({ ok: false, code: 2 });
  });

  test("launch --isolated moves HOME into a profile and waits for the window", async () => {
    const profile = mkdtempSync(join(tmpdir(), "dolly-profile-"));
    const ctx = fakeContext();
    const out = await run(["launch", "Margin", "--isolated", profile, "--size", "1280,800", "--at", "200,120"], ctx);
    expect(out).toMatchObject({ ok: true, pid: 4711, ready: true, profile });
    const launched = ctx.driver.of("launch")[0]!;
    expect(launched.fresh).toBe(true);
    if (process.platform !== "win32") expect(launched.environment.HOME).toBe(profile);
    expect(existsSync(join(profile, "tmp"))).toBe(true);
    expect(ctx.driver.of("resize")[0]).toEqual({ pid: 4711, width: 1280, height: 800 });
    expect(ctx.driver.of("place")[0]).toEqual({ pid: 4711, x: 200, y: 120 });
  });

  test("launch reports not ready when no window appears in time", async () => {
    const ctx = fakeContext(new FakeDriver({ windows: [] }));
    const out = await run(["launch", "Margin", "--wait", "1"], ctx);
    expect(out).toMatchObject({ ok: true, ready: false });
    expect(ctx.driver.of("launch")[0]!.fresh).toBe(false);
  });

  test("press, find, focus, quit", async () => {
    const ctx = fakeContext();
    expect(await run(["press", "4711", "new note"], ctx)).toMatchObject({ ok: true, pressed: "AXButton New Note" });
    expect(await run(["press", "4711", "nothing"], ctx)).toMatchObject({ ok: false, code: 5 });
    expect(await run(["find", "4711", "Groceries"], ctx)).toMatchObject({ count: 1 });
    expect(await run(["focus", "4711"], ctx)).toMatchObject({ ok: true, front: 4711 });
    expect(await run(["quit", "4711", "--force"], ctx)).toMatchObject({ running: false, forced: true });
  });
});

describe("events", () => {
  test("a take log turns input into beats in seconds and window fractions", async () => {
    const ctx = fakeContext();
    const log = join(mkdtempSync(join(tmpdir(), "dolly-log-")), "take.jsonl");
    await run(["events", "start", log], ctx);
    await run(["record", "61527", "frames", "6"], ctx);
    await ctx.sleep(1500);
    await run(["click", "840,520", "--ms", "0"], ctx);
    await run(["front"], ctx); // not an input verb: not logged
    expect(await run(["events", "status"], ctx)).toMatchObject({ running: true, count: 2 });
    const out = await run(["events", "stop"], ctx);
    expect(out).toMatchObject({ ok: true, count: 2, origin: 1_700_000_000_000, frame: [200, 120, 1280, 800] });
    expect(out.beats).toEqual([{ verb: "click", at: 1.5, until: 1.5, screen: [840, 520], point: [0.5, 0.5] }]);
    expect(readFileSync(log, "utf8").trim().split("\n").length).toBe(2);
    expect(await run(["events", "stop"], ctx)).toMatchObject({ ok: false, code: 5 });
  });
});

describe("client", () => {
  test("call runs a verb with typed params and throws with the exit code", async () => {
    const ctx = fakeContext();
    const { windows } = await call("windows", { layer: 0 }, ctx);
    expect(windows.map((w) => w.id)).toEqual([61527, 120]);
    const failure = await call("tree", { pid: 999, depth: 40, limit: 600, menus: false }, ctx).catch((e) => e);
    expect(failure).toBeInstanceOf(DollyError);
    expect(failure.code).toBe(5);
  });
});
