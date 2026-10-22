// pi's RPC mode: one JSON object per line on stdin and stdout. Only "\n"
// ends a record (U+2028 is legal inside JSON strings), and a trailing "\r" is
// dropped. See pi's docs/rpc.md.

export type PiCommand =
  | { type: "prompt"; message: string; id?: string; streamingBehavior?: "steer" | "followUp" }
  | { type: "abort"; id?: string }
  | { type: "get_session_stats"; id?: string }
  | { type: "extension_ui_response"; id: string; value?: string; confirmed?: boolean; cancelled?: true };

export type PiEvent =
  | { type: "response"; id?: string; command: string; success: boolean; data?: unknown; error?: string }
  | { type: "agent_start" }
  | { type: "agent_end" }
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: "tool_execution_end"; toolCallId: string; toolName: string; isError: boolean }
  | { type: "extension_ui_request"; id: string; method: "select"; title: string; options: string[]; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "confirm"; title: string; message?: string; timeout?: number }
  | { type: "extension_ui_request"; id: string; method: "setStatus"; statusKey: string; statusText?: string }
  | { type: "extension_ui_request"; id: string; method: "notify"; message: string; notifyType?: "info" | "warning" | "error" }
  | { type: "other"; raw: Record<string, unknown> };

export function encode(command: PiCommand): string {
  return JSON.stringify(command) + "\n";
}

/** Splits a byte stream into records on "\n" only. */
export class LineSplitter {
  private buffer = "";

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let at: number;
    while ((at = this.buffer.indexOf("\n")) >= 0) {
      let line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.trim()) lines.push(line);
    }
    return lines;
  }
}

const KNOWN = new Set(["response", "agent_start", "agent_end", "tool_execution_start", "tool_execution_end"]);
const UI_METHODS = new Set(["select", "confirm", "setStatus", "notify"]);

export function parse(line: string): PiEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (KNOWN.has(String(record.type))) return record as PiEvent;
  if (record.type === "extension_ui_request" && UI_METHODS.has(String(record.method))) return record as PiEvent;
  return { type: "other", raw: record };
}

export interface PiLaunch {
  /** The skill that teaches the agent dolly's verbs. */
  skill: string;
  /** Studio's extension: the `film` and `ask` tools. */
  extension: string;
  sessionDir: string;
  provider?: string;
  model?: string;
}

export function piArgs(launch: PiLaunch): string[] {
  const args = ["--mode", "rpc", "--tools", "read,bash", "--skill", launch.skill, "-e", launch.extension, "--session-dir", launch.sessionDir];
  if (launch.provider) args.push("--provider", launch.provider);
  if (launch.model && launch.model !== "Recommended") args.push("--model", launch.model);
  return args;
}
