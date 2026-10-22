// `service start|stop|status`: the driver's launchd (or platform) service.
// The lifecycle belongs to the driver binary; the CLI only hands it the socket.

import { spawnSync } from "node:child_process";
import { UsageError } from "@dolly/core";
import { Failure } from "../failure.ts";
import { driverBinary, socketPath } from "../paths.ts";
import { verb } from "../verb.ts";

export const service = verb({
  name: "service",
  summary: "start, stop or report the driver service (macOS grants Accessibility per process)",
  usage: "dolly service start|stop|status",
  parse(args) {
    const action = args.positional[0] ?? "status";
    if (!["start", "stop", "status"].includes(action)) throw new UsageError("expected start, stop or status");
    return { action: action as "start" | "stop" | "status" };
  },
  async run({ action }) {
    const binary = driverBinary();
    const result = spawnSync(binary, ["service", action, "--socket", socketPath()], { encoding: "utf8" });
    if (result.error) throw new Failure(`no driver at ${binary}; install Dolly.app or set DOLLY_DRIVER`);
    const line = result.stdout.split("\n").find((l) => l.trim());
    if (!line) throw new Failure(`${binary} printed nothing`);
    const response = JSON.parse(line) as { ok: boolean; code?: number; error?: string } & Record<string, unknown>;
    if (!response.ok) throw new Failure(response.error ?? "service failed", (response.code ?? 5) as 5);
    const { ok: _, code: __, ...fields } = response;
    return fields;
  },
});
