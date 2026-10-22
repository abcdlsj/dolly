// A clock that only moves when the code under test sleeps, so a whole film
// plays in milliseconds and countdowns run out on cue.

import type { Clock } from "../src/agent/director.ts";
import type { AppRef } from "../src/model/types.ts";

export class FakeClock implements Clock {
  time = 1_000_000;

  now = (): number => this.time;

  async sleep(ms: number): Promise<void> {
    this.time += ms;
    await new Promise((resolve) => setImmediate(resolve));
  }
}

export const MARGIN: AppRef = { name: "Margin", path: "/Applications/Margin.app", version: "3.2", tint: "#AEB7C2" };

/** Lets queued promise callbacks run until `done` holds or the turns run out. */
export async function until(done: () => boolean, turns = 200_000): Promise<void> {
  for (let turn = 0; turn < turns && !done(); turn++) await new Promise((resolve) => setImmediate(resolve));
  if (!done()) throw new Error("condition never held");
}
