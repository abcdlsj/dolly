// One CLI verb: how argv becomes typed params, and what running it does.
// `client.call` skips `parse`, so Studio and agents can pass params directly.

import type { LogEntry } from "@dolly/core";
import type { Args } from "./args.ts";
import type { Context } from "./context.ts";

export interface Verb<P, R extends object> {
  name: string;
  summary: string;
  usage: string;
  parse(args: Args, argv: readonly string[]): P;
  run(params: P, ctx: Context): Promise<R>;
  /** What the event log records when this verb succeeds while a log is armed. */
  log?(params: P, result: R): Omit<LogEntry, "verb" | "t" | "end"> & { t?: number };
}

export function verb<P, R extends object>(definition: Verb<P, R>): Verb<P, R> {
  return definition;
}
