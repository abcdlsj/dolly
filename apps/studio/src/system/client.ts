// How Studio reaches dolly itself. The web view cannot load `@dolly/cli/client`
// (it needs sockets and processes), so in the app the Rust side runs the
// bundled `dolly` binary and hands back its one JSON object; in a browser tab a
// fake answers. The agent does the filming through its own `dolly` calls;
// Studio only asks about permissions.

import type { Output } from "@dolly/cli/client";

export type { Output };

export interface DollyClient {
  run(argv: string[]): Promise<Output>;
}

/** Whether Accessibility is allowed; with `prompt`, asks macOS to show its dialog. */
export async function trusted(client: DollyClient, prompt = false): Promise<boolean> {
  const output = await client.run(prompt ? ["trust", "--prompt", "--wait", "0"] : ["trust"]);
  return output.ok && output.trusted === true;
}

export class FakeClient implements DollyClient {
  readonly calls: string[][] = [];

  async run(argv: string[]): Promise<Output> {
    this.calls.push(argv);
    const command = argv[0] ?? "help";
    if (command === "trust") return { ok: true, code: 0, command, trusted: true };
    if (command === "windows") return { ok: true, code: 0, command, windows: [] };
    return { ok: true, code: 0, command };
  }
}
