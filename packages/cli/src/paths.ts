// Where dolly keeps its socket and state, and where the driver binary is.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export function cacheDir(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Caches");
  if (process.platform === "win32") return process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  return process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");
}

/** The driver service's socket. `DOLLY_SOCKET` overrides it for the CLI and the driver alike. */
export function socketPath(): string {
  const configured = process.env.DOLLY_SOCKET;
  if (configured) return configured;
  if (process.platform === "win32") return "\\\\.\\pipe\\dolly";
  return join(cacheDir(), "dolly", "dolly.sock");
}

/** Next to the socket: the event-log arming file and isolated app profiles. */
export function stateDir(): string {
  return process.platform === "win32" ? join(cacheDir(), "dolly") : dirname(socketPath());
}

/**
 * `DOLLY_DRIVER`, else `dolly-driver` next to this executable (how Dolly.app
 * ships them), else a development build in drivers/, else the PATH.
 */
export function driverBinary(): string {
  if (process.env.DOLLY_DRIVER) return process.env.DOLLY_DRIVER;
  const name = process.platform === "win32" ? "dolly-driver.exe" : "dolly-driver";
  const sibling = join(dirname(process.execPath), name);
  if (existsSync(sibling)) return sibling;
  const development = resolve(import.meta.dir, "..", "..", "..", "drivers", "macos", ".build", "release", name);
  if (existsSync(development)) return development;
  return name;
}

/** A file argument as the caller meant it: `~` expanded, relative to `cwd`. */
export function resolveFile(text: string, cwd: string): string {
  const expanded = text === "~" || text.startsWith("~/") ? join(homedir(), text.slice(1)) : text;
  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}
