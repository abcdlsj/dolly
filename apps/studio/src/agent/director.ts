// A director turns a film request into a finished film by driving the store.
// PiDirector does it with the real agent; SimulatedDirector plays a scripted
// run so Studio can be tried, demoed and tested without a model or a Mac.

import type { Store } from "../model/store.ts";

export interface Director {
  /** Starts listening to the store; returns a stop function. */
  attach(store: Store): () => void;
}

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
