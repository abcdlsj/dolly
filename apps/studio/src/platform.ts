// Everything that differs between the Wails shell and a plain browser tab
// (vite dev, tests). The Go side owns processes and secrets, so the API key
// never reaches the web view: it is read from the login keychain and handed to
// pi as an environment variable.

import { broadcastChannel, type Channel, type Message } from "./bridge.ts";
import type { PiProcess, Spawn } from "./agent/pi.ts";
import { piArgs } from "./agent/rpc.ts";
import { FakeClient, trusted, type DollyClient, type Output } from "./system/client.ts";

export type Panel = "main" | "settings" | "glance" | "tray";

/** True inside Dolly.app; Wails serves the page over its own scheme. */
export const isNative = typeof window !== "undefined" && location.protocol === "wails:";
export const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

type Runtime = {
  Call: { ByName(method: string, ...args: unknown[]): Promise<unknown> };
  Events: {
    On(name: string, callback: (event: { data: unknown }) => void): () => void;
    Emit(name: string, data?: unknown): void;
  };
};

const RUNTIME = "/wails/runtime.js";
let runtime: Promise<Runtime> | undefined;

/** Wails' JavaScript runtime, pulled in only in the app. */
function shell(): Promise<Runtime> {
  runtime ??= import(/* @vite-ignore */ RUNTIME) as Promise<Runtime>;
  return runtime;
}

/** Studio is the single Go service the web view may call: `package.Type.Method`. */
const SERVICE = "main.Studio.Invoke";

/** Runs one command. The Go side dispatches on the name and reads `args`. */
export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const { Call } = await shell();
  return Call.ByName(SERVICE, command, args) as Promise<T>;
}

async function on<T>(name: string, listener: (payload: T) => void): Promise<() => void> {
  const { Events } = await shell();
  return Events.On(name, (event) => listener(event.data as T));
}

export function channel(): Channel {
  if (!isNative) return broadcastChannel();
  const listeners = new Set<(message: Message) => void>();
  void shell().then(({ Events }) => Events.On("studio", (event) => {
    for (const listener of listeners) listener(event.data as Message);
  }));
  return {
    post: (message) => void shell().then(({ Events }) => Events.Emit("studio", message)),
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function openPanel(panel: Panel): void {
  if (isNative) void invoke("show_window", { label: panel });
  else if (panel === "main") window.open("#/", "dolly-main");
  else window.open(`#/${panel}`, `dolly-${panel}`, panel === "settings" ? "width=640,height=640" : "width=360,height=520");
}

export function hidePanel(panel: Panel): void {
  if (isNative) void invoke("hide_window", { label: panel });
}

export function closePanel(): void {
  if (isNative) void invoke("hide_window", { label: route() });
  else window.close();
}

export function quit(): void {
  if (isNative) void invoke("quit");
}

export async function notify(title: string, body: string): Promise<void> {
  if (isNative) return invoke("notify", { title, body });
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

export async function saveKey(provider: string, key: string): Promise<string> {
  if (!isNative) return key.slice(-4);
  return invoke<string>("secret_set", { provider, key });
}

export async function testConnection(provider: string, endpoint = ""): Promise<{ ok: boolean; ms: number; error?: string }> {
  if (!isNative) return { ok: true, ms: 0 };
  return invoke("provider_check", { provider, endpoint });
}

/** `dolly` itself: the bundled binary through the Go side, or a fake in a browser tab. */
export const dolly: DollyClient = isNative ? { run: (argv) => invoke<Output>("dolly", { argv }) } : new FakeClient();

export interface Permissions {
  screen: boolean;
  accessibility: boolean;
  /** Why Accessibility cannot be answered: dolly itself did not run. */
  problem?: string;
}

export async function permissions(): Promise<Permissions> {
  if (!isNative) return { screen: true, accessibility: true };
  const screen = await invoke<boolean>("screen_access").catch(() => false);
  try {
    return { screen, accessibility: await trusted(dolly) };
  } catch (error) {
    // A build without `dolly` next to it cannot answer, and saying "not allowed"
    // would send the person to a System Settings row that will never appear.
    return { screen, accessibility: false, problem: error instanceof Error ? error.message : String(error) };
  }
}

/** Asks macOS for the permission, then opens its pane in System Settings. */
export function askPermission(kind: keyof Permissions): void {
  if (!isNative) return;
  if (kind === "accessibility") void trusted(dolly, true).catch(() => false);
  void invoke("open_permission_settings", { kind });
}

export interface InstalledApp {
  name: string;
  path: string;
  version: string;
}

const SAMPLE_APPS: InstalledApp[] = [
  { name: "Margin", path: "/Applications/Margin.app", version: "3.2" },
  { name: "Tempo", path: "/Applications/Tempo.app", version: "1.8" },
  { name: "Ledger", path: "/Applications/Ledger.app", version: "5.0.1" },
];

export async function installedApps(): Promise<InstalledApp[]> {
  if (!isNative) return SAMPLE_APPS;
  return invoke<InstalledApp[]>("installed_apps");
}

/** Shows a file in Finder (or the system file manager). */
export function reveal(path: string): void {
  if (isNative) void invoke("reveal", { path });
}

/** The short status next to the menu bar icon, like “3/5”; empty hides it. */
export function setTrayTitle(title: string): void {
  if (isNative) void invoke("tray_title", { title });
}

export async function chooseApp(): Promise<InstalledApp | null> {
  if (!isNative) return null;
  return invoke("choose_app");
}

/** A local file the web view may show: the Go asset server streams it, ranges included. */
export function fileSrc(path: string): string {
  return isNative ? `/_dolly/file?path=${encodeURIComponent(path)}` : path;
}

/** Spawns `pi --mode rpc` through the Go side, one process per film. */
export const spawnPi: Spawn = async (film, settings) => {
  const paths = await invoke<{ skill: string; extension: string; sessions: string }>("agent_paths");
  // An OpenAI-compatible address becomes pi's own `dolly` provider, described
  // in a models.json the Go side writes; the named providers are pi's.
  const custom = settings.provider === "custom";
  const endpoint = custom ? settings.endpoint.trim() : "";
  if (custom && !endpoint) throw new Error("Set the provider's address in Settings.");
  const args = piArgs({
    skill: paths.skill,
    extension: paths.extension,
    sessionDir: `${paths.sessions}/${film.id}`,
    provider: custom ? "dolly" : settings.provider,
    model: settings.model,
  });
  const lines = new Set<(line: string) => void>();
  const exits = new Set<(code: number | null, stderr: string) => void>();
  const stopLines = await on<{ id: string; line: string }>("pi-line", (payload) => {
    if (payload.id === film.id) for (const listener of lines) listener(payload.line);
  });
  const stopExit = await on<{ id: string; code: number | null; stderr: string }>("pi-exit", (payload) => {
    if (payload.id !== film.id) return;
    stopLines();
    stopExit();
    for (const listener of exits) listener(payload.code, payload.stderr ?? "");
  });
  await invoke("pi_start", { id: film.id, args, provider: settings.provider, endpoint, model: settings.model });
  const process: PiProcess = {
    // The Go side ends each record with its own "\n".
    send: (line) => void invoke("pi_send", { id: film.id, line: line.replace(/\n$/, "") }),
    onLine: (listener) => lines.add(listener),
    onExit: (listener) => exits.add(listener),
    kill: () => void invoke("pi_kill", { id: film.id }),
  };
  return process;
};

export function route(): Panel {
  const hash = typeof location === "undefined" ? "" : location.hash.replace(/^#\/?/, "");
  return hash === "settings" || hash === "glance" || hash === "tray" ? hash : "main";
}
