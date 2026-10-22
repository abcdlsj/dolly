// dolly as a library, for Studio and anything else in TypeScript:
//
//   import { call } from "@dolly/cli/client";
//   const { windows } = await call("windows", { layer: 0 });
//   await call("click", { to: { x: 640, y: 420 }, button: "left", count: 1, modifiers: [], hold: 0, ms: 700, ease: "inOut" });
//
// Params are each verb's typed params (what its `parse` returns from argv);
// failures throw `DollyError` with the CLI's exit code. Pass a context with a
// `FakeDriver` (see ./fake.ts) to run without a platform.

import { Code } from "@dolly/protocol";
import { systemContext, type Context } from "./context.ts";
import { execute, failure, run as runArgv, type Output } from "./run.ts";
import { VERBS, type ParamsOf, type ResultOf, type VerbName } from "./registry.ts";
import type { Verb } from "./verb.ts";

export class DollyError extends Error {
  constructor(
    message: string,
    readonly code: Code,
  ) {
    super(message);
  }
}

let shared: Context | undefined;

/** Params with every key that may be undefined made optional. */
export type CallParams<T> = { [K in keyof T as undefined extends T[K] ? K : never]?: T[K] } & {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
};

export async function call<N extends VerbName>(name: N, params: CallParams<ParamsOf<N>>, ctx: Context = (shared ??= systemContext())): Promise<ResultOf<N>> {
  const verb = VERBS[name] as unknown as Verb<ParamsOf<N>, ResultOf<N> & object>;
  try {
    return await execute(verb, params as ParamsOf<N>, ctx);
  } catch (error) {
    const { code, error: message } = failure(error);
    throw new DollyError(message, code);
  }
}

/** The CLI itself, argv in and its JSON object out, without a process. */
export function run(argv: readonly string[], ctx: Context = (shared ??= systemContext())): Promise<Output> {
  return runArgv(argv, ctx);
}

export { systemContext, type Context } from "./context.ts";
export type { Driver } from "./driver.ts";
export { VERBS, type ParamsOf, type ResultOf, type VerbName } from "./registry.ts";
export type { Output } from "./run.ts";
