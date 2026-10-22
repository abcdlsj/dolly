// Refusals that keep input away from the wrong app, and the trust check.

import { windowAt } from "@dolly/core";
import { Code } from "@dolly/protocol";
import type { Args } from "./args.ts";
import type { Context } from "./context.ts";
import { Failure } from "./failure.ts";

/** Input params every moving or typing verb shares. */
export interface Guarded {
  /** The app that must be frontmost: pids, bundle ids or names. Empty means any. */
  guard?: string[];
}

export function parseGuard(args: Args): Guarded {
  const guard = args.strings("guard");
  return guard.length ? { guard } : {};
}

export async function requireTrust(ctx: Context): Promise<void> {
  // DOLLY_ASSUME_TRUST is for diagnosing whether events land when this
  // process is not the trusted one; it never changes what `trust` reports.
  if (ctx.env.DOLLY_ASSUME_TRUST === "1") return;
  const { trusted } = await ctx.driver.call("trust", {});
  if (!trusted) throw new Failure("Accessibility is not granted to the dolly driver", Code.untrusted);
}

export async function guardFront(ctx: Context, guard: string[] | undefined): Promise<void> {
  if (!guard?.length) return;
  const front = await ctx.driver.call("front", {}).catch(() => null);
  if (!front) throw new Failure("refused: no frontmost app", Code.refused);
  if (!guard.some((g) => g === String(front.pid) || g === front.bundle || g === front.name)) {
    throw new Failure(`refused: frontmost is ${front.name} (${front.bundle}, pid ${front.pid})`, Code.refused);
  }
}

/**
 * The app that must own the window under the pointer. It covers the first
 * click of a session, when the target is not frontmost yet and `--guard`
 * would be wrong to demand.
 */
export async function guardOwner(ctx: Context, owner: number | undefined): Promise<void> {
  if (owner === undefined) return;
  const [{ x, y }, { windows }] = await Promise.all([
    ctx.driver.call("pointer", {}),
    ctx.driver.call("windows", { layer: 0 }),
  ]);
  const window = windowAt(windows, x, y);
  if (!window) throw new Failure("refused: no window under the pointer", Code.refused);
  if (window.pid !== owner) {
    throw new Failure(`refused: window under the pointer belongs to pid ${window.pid}, not ${owner}`, Code.refused);
  }
}
