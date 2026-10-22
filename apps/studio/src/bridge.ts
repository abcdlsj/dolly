// Keeps every Studio window on one state. The main window publishes each
// snapshot and runs the actions other windows send; those windows render the
// snapshot they last received. In Tauri this rides on app events; in a
// browser (vite dev) on a BroadcastChannel.

import type { NewFilm, Snapshot } from "./model/store.ts";
import { DEFAULT_SETTINGS, type Settings } from "./model/types.ts";
import type { Action, Studio } from "./state.tsx";

/** Where the main window should go when another window asks: a film, or the New Film sheet. */
export type Destination = { film: string } | { newFilm: true } | { library: true };

export type Message =
  | { kind: "snapshot"; snapshot: Snapshot }
  | { kind: "action"; action: Action }
  | { kind: "hello" }
  | { kind: "open"; to: Destination };

export interface Channel {
  post(message: Message): void;
  listen(listener: (message: Message) => void): () => void;
}

export function broadcastChannel(name = "dolly-studio"): Channel {
  const channel = new BroadcastChannel(name);
  return {
    post: (message) => channel.postMessage(message),
    listen(listener) {
      const handler = (event: MessageEvent<Message>) => listener(event.data);
      channel.addEventListener("message", handler);
      return () => channel.removeEventListener("message", handler);
    },
  };
}

/** Run in the main window: publish state, run remote actions. */
export function serve(studio: Studio, channel: Channel): () => void {
  const publish = () => channel.post({ kind: "snapshot", snapshot: studio.snapshot() });
  const stopStore = studio.subscribe(publish);
  const stopChannel = channel.listen((message) => {
    if (message.kind === "hello") publish();
    if (message.kind === "action") run(studio, message.action);
  });
  publish();
  return () => {
    stopStore();
    stopChannel();
  };
}

export function run(studio: Studio, action: Action): void {
  // Each action's arguments match its method by construction of `Action`.
  (studio[action.name] as (...args: unknown[]) => unknown)(...action.args);
}

/** A window that mirrors the main one. */
export class RemoteStudio implements Studio {
  private current: Snapshot = { films: [], settings: { ...DEFAULT_SETTINGS } };
  private listeners = new Set<() => void>();

  constructor(private channel: Channel) {
    channel.listen((message) => {
      if (message.kind !== "snapshot") return;
      this.current = message.snapshot;
      for (const listener of this.listeners) listener();
    });
    channel.post({ kind: "hello" });
  }

  snapshot = (): Snapshot => this.current;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Brings the main window forward at a film or the New Film sheet. */
  open(to: Destination): void {
    this.channel.post({ kind: "open", to });
  }

  private send(action: Action): void {
    this.channel.post({ kind: "action", action });
  }

  create(input: NewFilm): string {
    this.send({ name: "create", args: [input] });
    return "";
  }
  restart(filmId: string) { this.send({ name: "restart", args: [filmId] }); }
  answer(filmId: string, optionId: string) { this.send({ name: "answer", args: [filmId, optionId] }); }
  pause(filmId: string) { this.send({ name: "pause", args: [filmId] }); }
  resume(filmId: string) { this.send({ name: "resume", args: [filmId] }); }
  takeOver(filmId: string) { this.send({ name: "takeOver", args: [filmId] }); }
  retake(filmId: string, shotId: string) { this.send({ name: "retake", args: [filmId, shotId] }); }
  changeDirection(filmId: string, line: string) { this.send({ name: "changeDirection", args: [filmId, line] }); }
  message(filmId: string, text: string) { this.send({ name: "message", args: [filmId, text] }); }
  remove(filmId: string) { this.send({ name: "remove", args: [filmId] }); }
  updateSettings(change: Partial<Settings>) { this.send({ name: "updateSettings", args: [change] }); }
}
