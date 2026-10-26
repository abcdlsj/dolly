// What is on screen and whether dolly may drive it.

import { verb } from "../verb.ts";

export const front = verb({
  name: "front",
  summary: "report the frontmost app",
  usage: "dolly front",
  parse: () => ({}),
  run: (_, ctx) => ctx.driver.call("front", {}),
});

export const windows = verb({
  name: "windows",
  summary: "list windows front to back, with ids and frames",
  usage: "dolly windows [--pid n] [--layer 0 | --any-layer]",
  parse: (args) => ({ pid: args.number("pid"), layer: args.flag("any-layer") ? null : args.number("layer", 0) }),
  async run({ pid, layer }, ctx) {
    const { windows } = await ctx.driver.call("windows", { ...(pid === undefined ? {} : { pid }), layer });
    return { count: windows.length, windows };
  },
});

export const trust = verb({
  name: "trust",
  summary: "report Accessibility trust (or Screen Recording with --screen), optionally ask for it",
  usage: "dolly trust [--screen] [--prompt [--wait 60]]",
  parse: (args) => ({ prompt: args.flag("prompt"), wait: args.number("wait", 60), screen: args.flag("screen") }),
  run: ({ prompt, wait, screen }, ctx) =>
    ctx.driver.call("trust", { ...(prompt ? { prompt, wait } : {}), ...(screen ? { screen } : {}) }),
});
