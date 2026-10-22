// Every verb, in the order `help` lists them. Adding a verb is one file in
// verbs/ and one line here.

import { click, drag, hover, key, move, path, release, scroll, type } from "./verbs/input.ts";
import { controls, find, focus, launch, place, press, quit, resize, tree } from "./verbs/apps.ts";
import { capture, record, snap } from "./verbs/capture.ts";
import { camera } from "./verbs/camera.ts";
import { events } from "./verbs/events.ts";
import { service } from "./verbs/service.ts";
import { front, trust, windows } from "./verbs/system.ts";
import type { Verb } from "./verb.ts";

export const VERBS = {
  move, path, hover, click, drag, scroll, key, type, release,
  press, find, controls, tree, focus, place, resize,
  front, windows, trust,
  launch, quit, snap,
  record, capture, events, camera,
  service,
};

export type VerbName = keyof typeof VERBS;
type VerbOf<N extends VerbName> = (typeof VERBS)[N];
export type ParamsOf<N extends VerbName> = VerbOf<N> extends Verb<infer P, object> ? P : never;
export type ResultOf<N extends VerbName> = Awaited<ReturnType<VerbOf<N>["run"]>>;

export function lookup(name: string): Verb<unknown, object> | undefined {
  return Object.hasOwn(VERBS, name) ? (VERBS[name as VerbName] as unknown as Verb<unknown, object>) : undefined;
}

export function helpText(): string {
  const lines = [
    "dolly — pointer, keyboard and accessibility input for screen recordings, and camera moves in post",
    "",
    "Usage: dolly <command> [positional...] [--flags]",
    "",
    "Commands:",
  ];
  for (const verb of Object.values(VERBS)) {
    lines.push(`  ${verb.name.padEnd(9)} ${verb.summary}`);
    lines.push(`  ${" ".repeat(9)}   ${verb.usage.split("\n")[0]}`);
  }
  lines.push(
    "",
    "Shared flags:",
    "  --guard <pid|bundle|name>  refuse to run unless that app is frontmost",
    "  --owner <pid>              (drag) refuse unless the window under the pointer is that app's",
    "  --ms <n>                   travel time in milliseconds (default 700)",
    "  --ease inOut|out|inQuint|linear",
    "",
    "Every command prints one JSON object with ok, code, command and its own fields;",
    "this text is the help command's `text` field.",
    "Exit codes: 0 ok, 2 usage, 3 refused, 4 untrusted, 5 failed.",
  );
  return lines.join("\n");
}
