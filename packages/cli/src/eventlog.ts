// `dolly events start <file>` arms a log; while armed, every input verb and
// every capture appends one JSON line. The arming is a file in the state
// directory rather than process state, because each dolly call is its own
// process.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { LogEntry } from "@dolly/core";

export class EventLog {
  constructor(readonly directory: string) {}

  private get armPath(): string {
    return join(this.directory, "events.path");
  }

  armed(): string | null {
    if (!existsSync(this.armPath)) return null;
    const path = readFileSync(this.armPath, "utf8").trim();
    return path || null;
  }

  arm(file: string): void {
    mkdirSync(this.directory, { recursive: true });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "");
    writeFileSync(this.armPath, file);
  }

  disarm(): void {
    rmSync(this.armPath, { force: true });
  }

  note(entry: LogEntry): void {
    const file = this.armed();
    if (file) appendFileSync(file, JSON.stringify(entry) + "\n");
  }

  static read(file: string): LogEntry[] {
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as LogEntry];
        } catch {
          return [];
        }
      });
  }
}
