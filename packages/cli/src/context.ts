// What a verb runs against. Tests and Studio swap the driver and the clock.

import { AutoDriver, type Driver } from "./driver.ts";
import { EventLog } from "./eventlog.ts";
import { stateDir } from "./paths.ts";

export interface Context {
  driver: Driver;
  /** The caller's directory: relative file arguments resolve against it. */
  cwd: string;
  now(): number;
  sleep(ms: number): Promise<void>;
  events: EventLog;
  env: Record<string, string | undefined>;
}

export function systemContext(overrides: Partial<Context> = {}): Context {
  return {
    driver: new AutoDriver(),
    cwd: process.cwd(),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(ms, 0))),
    events: new EventLog(stateDir()),
    env: process.env,
    ...overrides,
  };
}
