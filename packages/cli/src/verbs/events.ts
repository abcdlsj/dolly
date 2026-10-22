// `events start|stop|status`: the take log that lines camera moves up with input.

import { beatsFromLog, UsageError } from "@dolly/core";
import { Code } from "@dolly/protocol";
import { EventLog } from "../eventlog.ts";
import { Failure } from "../failure.ts";
import { resolveFile } from "../paths.ts";
import { verb } from "../verb.ts";

function summary(action: string, file: string) {
  const entries = EventLog.read(file);
  const { origin, frame, beats } = beatsFromLog(entries);
  return { action, file, count: entries.length, beats, ...(origin !== null ? { origin } : {}), ...(frame ? { frame } : {}) };
}

export const events = verb({
  name: "events",
  summary: "log input and capture times during a take, as shot-file beats",
  usage: "dolly events start <file.jsonl> | stop | status",
  parse(args) {
    const action = args.positional[0] ?? "status";
    if (action !== "start" && action !== "stop" && action !== "status") throw new UsageError("expected start, stop or status");
    return { action, file: action === "start" ? args.positionalString(1, "a log file") : undefined } as {
      action: "start" | "stop" | "status";
      file?: string;
    };
  },
  async run({ action, file }, ctx) {
    if (action === "start") {
      const path = resolveFile(file!, ctx.cwd);
      ctx.events.arm(path);
      return { action, file: path } as Record<string, unknown>;
    }
    const armed = ctx.events.armed();
    if (action === "status") return armed ? { ...summary(action, armed), running: true } : { action, running: false };
    if (!armed) throw new Failure("no event log is running", Code.failed);
    ctx.events.disarm();
    return summary(action, armed);
  },
});
