// The driver protocol: the few things only a platform can do, as JSON.
//
// A driver is a native process (drivers/macos is the first) that listens on a
// UNIX socket, or answers one request on stdin when run as `dolly-driver
// call`. Each request is one line of JSON, `{"op": …, …params}`, and each
// response is one line, `{"ok": true, …result}` or `{"ok": false, "code": n,
// "error": "…"}`. Everything else dolly does (argument parsing, guards,
// pointer curves, event logs, camera moves) lives in TypeScript and is the
// same on every platform.
//
// Coordinates are global screen points with the origin at the main display's
// top-left. Times are milliseconds.

/** Exit codes, shared by the driver and the CLI. */
export const Code = { ok: 0, usage: 2, refused: 3, untrusted: 4, failed: 5 } as const;
export type Code = (typeof Code)[keyof typeof Code];

export type Button = "left" | "right" | "middle";
export type Modifier = "cmd" | "shift" | "alt" | "ctrl";

/**
 * One step of an input timeline, `ms` after the timeline starts. The driver
 * plays steps by wall clock; when it falls behind it drops `move` and `drag`
 * steps that a later one supersedes, never a press, a release or a key.
 */
export type InputStep =
  | { ms: number; type: "move"; x: number; y: number }
  /** A move with the left button held, the event a drag session listens to. */
  | { ms: number; type: "drag"; x: number; y: number }
  /** `clicks` is the click count the event carries: 2 on the second click of a double click. */
  | { ms: number; type: "down" | "up"; button: Button; clicks: number; modifiers: Modifier[] }
  | { ms: number; type: "scroll"; dy: number; dx: number; unit: "line" | "pixel" }
  | { ms: number; type: "key"; code: number; down: boolean; modifiers: Modifier[] }
  /** Characters typed into the focused control, independent of the keyboard layout. */
  | { ms: number; type: "text"; text: string };

export interface Window {
  id: number;
  pid: number;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  onScreen: boolean;
}

export interface App {
  pid: number;
  name: string;
  bundle: string;
}

/** A control as the accessibility tree exposes it, in screen points. */
export interface Control {
  role: string;
  subrole?: string;
  title?: string;
  description?: string;
  value?: string;
  help?: string;
  actions?: string[];
  enabled?: false;
  focused?: true;
  frame: [x: number, y: number, width: number, height: number];
  /** Index of the nearest listed ancestor. */
  parent?: number;
}

/** Every op, its params and its result. The driver implements exactly these. */
export interface Ops {
  /**
   * Whether input from this process reaches the system, or with `screen`
   * whether it may capture windows; `prompt` asks the user and waits up to `wait` s.
   */
  trust: { params: { prompt?: boolean; wait?: number; screen?: boolean }; result: { trusted: boolean; waited?: number } };
  front: { params: Record<string, never>; result: App };
  /** Front to back, as the window server stacks them. `layer: null` lists every layer. */
  windows: { params: { pid?: number; layer?: number | null }; result: { windows: Window[] } };
  pointer: { params: Record<string, never>; result: { x: number; y: number } };
  /** Plays a timeline and returns once its last step is posted. */
  input: { params: { steps: InputStep[] }; result: { posted: number; dropped: number; ms: number } };

  /** Controls whose title, description, help or value equals `label`, case-insensitively. */
  find: { params: { pid: number; label: string }; result: { matches: string[] } };
  /** Performs AXPress (or the platform's default action) on the first match. */
  press: { params: { pid: number; label: string }; result: { pressed: string } };
  controls: { params: { pid: number; role: string }; result: { controls: string[] } };
  /** Flat list of the visible, meaningful controls inside `within` (a window frame). */
  tree: {
    params: { pid: number; within: [number, number, number, number]; depth: number; limit: number; menus: boolean };
    result: { nodes: Control[]; truncated: boolean };
  };

  activate: { params: { pid: number }; result: { front: App | null } };
  place: { params: { pid: number; x: number; y: number }; result: Record<string, never> };
  resize: { params: { pid: number; width: number; height: number }; result: Record<string, never> };

  /** One window as video at the display's frame rate. `started` is epoch ms of the first frame. */
  video: { params: { window: number; file: string; seconds: number }; result: { started: number; pixels: [number, number] } };
  /** Window-only PNG frames named by epoch ms, from `loops` capture loops in parallel. */
  frames: {
    params: { window: number; directory: string; seconds: number; loops: number };
    result: { started: number; frames: number; seconds: number };
  };
  /** One shadowless PNG of a window, downscaled so its longest side is at most `max` (0 keeps it). */
  still: { params: { window: number; file: string; max: number }; result: { pixels: [number, number] } };
  /**
   * Joins frames of one scrolling view into one tall PNG. `crop` is the
   * view's rectangle in pixels, `trim` the [top, bottom] bands kept out of
   * matching and seams, `chrome` keeps what lies above and below the crop.
   * `offsets[i]` is how many pixels frame i moved past frame i - 1, and
   * `costs[i]` how well they matched (0 is identical). Without `out` it only
   * measures.
   */
  stitch: {
    params: { files: string[]; crop?: [number, number, number, number]; trim?: [number, number]; out?: string; chrome?: boolean };
    result: { offsets: number[]; costs: number[]; pixels?: [number, number]; used?: number };
  };

  /**
   * Starts an app by path, bundle id or name. `environment` is added to its
   * environment; `fresh` asks for a new instance even when one is running.
   */
  launch: {
    params: { app: string; args: string[]; environment: Record<string, string>; fresh: boolean };
    result: { pid: number; app: string; bundle: string; sandboxed: boolean };
  };
  /** Asks an app to quit (or kills it) and waits up to `wait` s for it to exit. */
  quit: { params: { pid: number; force: boolean; wait: number }; result: { running: boolean } };
}

export type Op = keyof Ops;
export type Params<O extends Op> = Ops[O]["params"];
export type Result<O extends Op> = Ops[O]["result"];

export const OPS = [
  "trust", "front", "windows", "pointer", "input",
  "find", "press", "controls", "tree",
  "activate", "place", "resize",
  "video", "frames", "still", "stitch",
  "launch", "quit",
] as const satisfies readonly Op[];

/** Ops that touch the one pointer, keyboard focus or window layout; a driver runs them one at a time. */
export const SERIAL_OPS: readonly Op[] = ["input", "press", "activate", "place", "resize"];

export type Request<O extends Op = Op> = { op: O } & Params<O>;
export type Response<O extends Op = Op> = ({ ok: true } & Result<O>) | { ok: false; code: Code; error: string };

// Fails to compile when an op is added to `Ops` but not to `OPS`.
type Unlisted = Exclude<Op, (typeof OPS)[number]>;
export const OPS_COMPLETE: [Unlisted] extends [never] ? true : Unlisted = true;
