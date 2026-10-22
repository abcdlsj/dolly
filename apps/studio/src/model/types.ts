// What Studio shows: a film, its shots, and the one question Dolly may be
// waiting on. Everything else (logs, tool calls) folds into these.

import type { Move } from "@dolly/core";

export type Stage = "explore" | "direction" | "filming" | "final" | "ready";
export const STAGES: readonly Stage[] = ["explore", "direction", "filming", "final", "ready"];
export const STAGE_LABEL: Record<Stage, string> = {
  explore: "Explore",
  direction: "Direction",
  filming: "Filming",
  final: "Final Cut",
  ready: "Ready",
};

export type FormatId = "website" | "social" | "appstore";
export interface Format {
  id: FormatId;
  name: string;
  /** What the cut is called once it exists: Landscape, Portrait. */
  shape: string;
  ratio: string;
  aspect: string;
  size: readonly [number, number];
}
export const FORMATS: readonly Format[] = [
  { id: "website", name: "Website", shape: "Landscape", ratio: "16 : 9", aspect: "16:9", size: [1920, 1080] },
  { id: "social", name: "Social", shape: "Portrait", ratio: "9 : 16", aspect: "9:16", size: [1080, 1920] },
  { id: "appstore", name: "App Store", shape: "App Store", ratio: "16 : 10", aspect: "16:10", size: [2880, 1800] },
];

/** How often Dolly asks: only when it cannot continue, at key moments, or before filming too. */
export type AskLevel = "stuck" | "key" | "before";
export const ASK_LEVELS: readonly { id: AskLevel; name: string; detail: string }[] = [
  { id: "stuck", name: "Only if stuck", detail: "Dolly decides everything else on its own." },
  { id: "key", name: "At key moments", detail: "A short question when it matters, with a countdown. No answer, and Dolly goes with its pick." },
  { id: "before", name: "Before filming", detail: "Dolly suggests directions and waits for you to choose one." },
];

export type Length = 15 | 30 | 60;
export const LENGTHS: readonly Length[] = [15, 30, 60];

export type ShotState = "todo" | "live" | "retake" | "done";

export interface Shot {
  id: string;
  title: string;
  /** The camera move in the shot file's vocabulary. */
  move: Move;
  /** What the action is, in plain words: "Dragging the conflict to “Keep both”". */
  action: string;
  /** Why Dolly framed it this way. */
  why: string;
  seconds: number;
  state: ShotState;
  take: number;
}

export interface Option {
  id: string;
  label: string;
}

export interface Question {
  id: string;
  /** Shot the question is about, if any. */
  shotId?: string;
  text: string;
  options: Option[];
  /** The option Dolly takes when nobody answers. */
  recommended: string;
  /** Epoch ms when Dolly goes ahead; null waits for an answer. */
  deadline: number | null;
  /** The full countdown in seconds, for drawing how much is left. */
  seconds?: number;
}

export interface AppRef {
  name: string;
  path: string;
  version: string;
  /** The footage background Dolly picked for this app. */
  tint: string;
}

export interface ScreenFound {
  name: string;
  picked: boolean;
}

export interface Film {
  id: string;
  app: AppRef;
  createdAt: number;
  /** When the film first became ready. */
  finishedAt: number | null;
  formats: FormatId[];
  length: Length;
  ask: AskLevel;
  notes: string;
  stage: Stage;
  /** The one line the film says. Empty until Dolly settles on a direction. */
  line: string;
  why: string;
  alternatives: string[];
  screens: ScreenFound[];
  shots: Shot[];
  question: Question | null;
  /** What Dolly is doing right now, in plain words. */
  doing: string;
  /** Path of the latest snapshot of the app, shown until footage exists. */
  frame: string | null;
  /** Exported films, once ready. */
  outputs: string[];
  paused: boolean;
  /** The person took the mouse and keyboard back. */
  heldByYou: boolean;
  steps: number;
  cost: number;
  etaMinutes: number | null;
  version: number;
  error: string | null;
}

export interface Settings {
  provider: "anthropic" | "openai" | "openrouter" | "custom";
  model: string;
  /** Only the last four characters; the key itself lives in the system keychain. */
  keyHint: string;
  endpoint: string;
  spendLimit: number;
  ask: AskLevel;
  neverClick: string[];
  privateCopy: boolean;
  stopOnMouse: boolean;
  showPointer: boolean;
  notifyAsk: boolean;
  notifyReady: boolean;
  onboarded: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: "anthropic",
  model: "Recommended",
  keyHint: "",
  endpoint: "",
  spendLimit: 2,
  ask: "key",
  neverClick: ["Delete", "Buy", "Send", "Sign Out", "Reset"],
  privateCopy: true,
  stopOnMouse: true,
  showPointer: true,
  notifyAsk: true,
  notifyReady: true,
  onboarded: false,
};
