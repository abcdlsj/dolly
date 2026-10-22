// argv in, one JSON object and an exit code out.

import { ShotError, UsageError } from "@dolly/core";
import { Code } from "@dolly/protocol";
import { Args } from "./args.ts";
import type { Context } from "./context.ts";
import { Failure } from "./failure.ts";
import { helpText, lookup, VERBS } from "./registry.ts";
import type { Verb } from "./verb.ts";

export interface Output {
  ok: boolean;
  code: Code;
  command?: string;
  error?: string;
  [field: string]: unknown;
}

export function failure(error: unknown): { code: Code; error: string } {
  if (error instanceof ShotError) return { code: Code.usage, error: `bad shot: ${error.message}` };
  if (error instanceof UsageError) return { code: Code.usage, error: error.message };
  if (error instanceof Failure) return { code: error.code, error: error.message };
  return { code: Code.failed, error: error instanceof Error ? error.message : String(error) };
}

/** Runs one verb with typed params, logging it if a take log is armed. */
export async function execute<P, R extends object>(verb: Verb<P, R>, params: P, ctx: Context): Promise<R> {
  const started = ctx.now();
  const result = await verb.run(params, ctx);
  if (verb.log) {
    const { t, ...fields } = verb.log(params, result);
    ctx.events.note({ verb: verb.name, t: t ?? started, end: ctx.now(), ...fields });
  }
  return result;
}

export async function run(argv: readonly string[], ctx: Context): Promise<Output> {
  const [name, ...rest] = argv;
  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    return { ok: true, code: Code.ok, command: "help", text: helpText(), commands: Object.keys(VERBS) };
  }
  const verb = lookup(name);
  if (!verb) return { ok: false, code: Code.usage, command: name, error: `unknown command "${name}"; run dolly help` };
  try {
    const params = verb.parse(Args.parse(rest), rest);
    const result = await execute(verb, params, ctx);
    return { ...result, ok: true, code: Code.ok, command: name };
  } catch (error) {
    return { ok: false, command: name, ...failure(error) };
  }
}

/** One line, keys sorted, so output diffs and greps cleanly. */
export function encode(output: Output): string {
  const sorted = Object.fromEntries(Object.entries(output).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify(sorted);
}
