// Everything that differs between the Tauri app and a plain browser tab
// (vite dev, tests). The Rust side owns processes and secrets, so the API key
// never reaches the web view: it is read from the system keychain and handed
// to pi as an environment variable.

import { broadcastChannel, type Channel, type Message } from "./bridge.ts";
import type { PiProcess, Spawn } from "./agent/pi.ts";
import { piArgs } from "./agent/rpc.ts";
import { FakeClient, trusted, type DollyClient, type Output } from "./system/client.ts";

export type Panel = "main" | "settings" | "glance" | "tray";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export function channel(): Channel {
  if (!isTauri) return broadcastChannel();
  const listeners = new Set<(message: Message) => void>();
  void import("@tauri-apps/api/event").then(({ listen }) => listen<Message>("studio", (event) => {
    for (const listener of listeners) listener(event.payload);
  }));
  return {
    post: (message) => void import("@tauri-apps/api/event").then(({ emit }) => emit("studio", message)),
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function openPanel(panel: Panel): void {
  if (isTauri) void invoke("show_window", { label: panel });
  else if (panel === "main") window.open("#/", "dolly-main");
  else window.open(`#/${panel}`, `dolly-${panel}`, panel === "settings" ? "width=640,height=640" : "width=360,height=520");
}

export function hidePanel(panel: Panel): void {
  if (isTauri) void invoke("hide_window", { label: panel });
}

export function closePanel(): void {
  if (isTauri) void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().hide());
  else window.close();
}

export async function notify(title: string, body: string): Promise<void> {
  if (isTauri) {
    const notification = await import("@tauri-apps/plugin-notification");
    if (!(await notification.isPermissionGranted()) && (await notification.requestPermission()) !== "granted") return;
    notification.sendNotification({ title, body });
  } else if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    new Notification(title, { body });
  }
}

export async function saveKey(provider: string, key: string): Promise<string> {
  if (!isTauri) return key.slice(-4);
  return invoke<string>("secret_set", { provider, key });
}

export async function testConnection(provider: string, endpoint = ""): Promise<{ ok: boolean; ms: number; error?: string }> {
  if (!isTauri) return { ok: true, ms: 0 };
  return invoke("provider_check", { provider, endpoint });
}

/** `dolly` itself: the bundled binary through the Rust side, or a fake in a browser tab. */
export const dolly: DollyClient = isTauri ? { run: (argv) => invoke<Output>("dolly", { argv }) } : new FakeClient();

export interface Permissions {
  screen: boolean;
  accessibility: boolean;
}

export async function permissions(): Promise<Permissions> {
  if (!isTauri) return { screen: true, accessibility: true };
  const [screen, accessibility] = await Promise.all([invoke<boolean>("screen_access"), trusted(dolly).catch(() => false)]);
  return { screen, accessibility };
}

/** Asks macOS for the permission, then opens its pane in System Settings. */
export function askPermission(kind: keyof Permissions): void {
  if (!isTauri) return;
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
  if (!isTauri) return SAMPLE_APPS;
  return invoke<InstalledApp[]>("installed_apps");
}

/** Shows a file in Finder (or the system file manager). */
export function reveal(path: string): void {
  if (isTauri) void invoke("reveal", { path });
}

/** The short status next to the menu bar icon, like “3/5”; empty hides it. */
export function setTrayTitle(title: string): void {
  if (isTauri) void invoke("tray_title", { title });
}

export async function chooseApp(): Promise<InstalledApp | null> {
  if (!isTauri) return null;
  return invoke("choose_app");
}

/** Spawns `pi --mode rpc` through the Rust side, one process per film. */
export const spawnPi: Spawn = async (film, settings) => {
  const { listen } = await import("@tauri-apps/api/event");
  const paths = await invoke<{ skill: string; extension: string; sessions: string }>("agent_paths");
  const args = piArgs({
    skill: paths.skill,
    extension: paths.extension,
    sessionDir: `${paths.sessions}/${film.id}`,
    provider: settings.provider === "custom" ? "" : settings.provider,
    model: settings.model,
  });
  await invoke("pi_start", { id: film.id, args, provider: settings.provider });
  const lines = new Set<(line: string) => void>();
  const exits = new Set<(code: number | null) => void>();
  const stopLines = await listen<{ id: string; line: string }>("pi-line", (event) => {
    if (event.payload.id === film.id) for (const listener of lines) listener(event.payload.line);
  });
  const stopExit = await listen<{ id: string; code: number | null }>("pi-exit", (event) => {
    if (event.payload.id !== film.id) return;
    stopLines();
    stopExit();
    for (const listener of exits) listener(event.payload.code);
  });
  const process: PiProcess = {
    // The Rust side ends each record with its own "\n".
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
