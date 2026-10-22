// The log of a take: what dolly did and when, turned into shot-file beats so
// camera moves land on the frame an input happened instead of on a guess.

import type { Frame } from "./windows.ts";

/** One line of the log: a verb, its wall-clock span in epoch ms, and what it reported. */
export interface LogEntry {
  verb: string;
  t: number;
  end: number;
  /** Where the pointer ended up, in screen points. */
  to?: { x: number; y: number };
  label?: string;
  /** For a capture: the recorded window's frame, which turns screen points into window fractions. */
  frame?: Frame;
  [field: string]: unknown;
}

export interface LoggedBeat {
  verb: string;
  /** Seconds into the take. */
  at?: number;
  until?: number;
  label?: string;
  screen?: [number, number];
  /** Window fractions, what a shot file's `point` takes. */
  point?: [number, number];
}

export const CAPTURE_VERBS = ["record", "capture"];

export function beatsFromLog(entries: readonly LogEntry[]): { origin: number | null; frame: Frame | null; beats: LoggedBeat[] } {
  const take = entries.find((e) => CAPTURE_VERBS.includes(e.verb));
  const origin = take?.t ?? null;
  const frame = take?.frame ?? null;
  const seconds = (ms: number) => Math.round(ms / 10) / 100;
  const fraction = (v: number) => Math.round(v * 10000) / 10000;
  const beats: LoggedBeat[] = [];
  for (const entry of entries) {
    if (CAPTURE_VERBS.includes(entry.verb)) continue;
    const beat: LoggedBeat = { verb: entry.verb };
    if (origin !== null) {
      beat.at = seconds(entry.t - origin);
      beat.until = seconds(entry.end - origin);
    }
    if (entry.label !== undefined) beat.label = entry.label;
    if (entry.to) {
      beat.screen = [entry.to.x, entry.to.y];
      if (frame && frame[2] > 0 && frame[3] > 0) {
        beat.point = [fraction((entry.to.x - frame[0]) / frame[2]), fraction((entry.to.y - frame[1]) / frame[3])];
      }
    }
    beats.push(beat);
  }
  return { origin, frame, beats };
}
