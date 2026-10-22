// Pointer and keyboard gestures as input timelines a driver plays back.
//
// The timing here is what makes synthetic input read as a hand: a press held
// still before a drag starts, the drag threshold crossed slowly, a drop held
// long enough to film. Every platform gets the same choreography.

import type { Button, InputStep, Modifier } from "@dolly/protocol";
import type { PointerEase } from "./eases.ts";
import { distance, travel, type ScreenPoint } from "./pointer.ts";

/** Steps shifted to start `offset` ms later. */
export function after(offset: number, steps: readonly InputStep[]): InputStep[] {
  return steps.map((step) => ({ ...step, ms: step.ms + offset }));
}

/** When the last step happens: where the next phase of a gesture can start. */
export function end(steps: readonly InputStep[]): number {
  return steps.reduce((latest, step) => Math.max(latest, step.ms), 0);
}

export function moveSteps(
  from: ScreenPoint,
  path: readonly ScreenPoint[],
  ms: number,
  ease: PointerEase,
  dragging = false,
): InputStep[] {
  const type = dragging ? "drag" : "move";
  return travel(from, path, ms, ease).map(({ ms, x, y }) => ({ ms, type, x, y }));
}

export interface ClickOptions {
  button: Button;
  count: number;
  modifiers: Modifier[];
}

/**
 * Presses and releases where the pointer is: 30 ms down, 60 ms between
 * clicks, each press carrying its click number so the second is a double.
 * Modifiers ride on the press itself; a separate chord would type into
 * whatever has focus instead of modifying the click.
 */
export function clickSteps({ button, count, modifiers }: ClickOptions): InputStep[] {
  const steps: InputStep[] = [];
  for (let click = 1; click <= Math.max(count, 1); click++) {
    const at = (click - 1) * 90;
    steps.push({ ms: at, type: "down", button, clicks: click, modifiers });
    steps.push({ ms: at + 30, type: "up", button, clicks: click, modifiers });
  }
  return steps;
}

/** A one-point wiggle that keeps a hover timer alive without visibly moving the pointer. */
export function nudgeSteps(at: ScreenPoint, nudge: number): InputStep[] {
  if (nudge <= 0) return [];
  return [
    { ms: 0, type: "move", x: at.x + nudge, y: at.y },
    { ms: 8, type: "move", x: at.x, y: at.y },
  ];
}

export interface DragOptions {
  via: readonly ScreenPoint[];
  /** Travel time from the threshold to the drop. */
  ms: number;
  ease: PointerEase;
  /** Still before the press, once the pointer has arrived. */
  settle: number;
  /** Still after the press: what makes a view start a drag session instead of reading a click. */
  pressHold: number;
  /** Still at the drop before the release, so a drop overlay is on screen long enough to film. */
  hold: number;
}

/**
 * Everything after the pointer reaches `start`: settle, press, hold still,
 * cross the platform's drag threshold (5 pt on AppKit) slowly and in the
 * direction of travel, travel while held, hold, release.
 */
export function dragSteps(start: ScreenPoint, destination: ScreenPoint, options: DragOptions): InputStep[] {
  const span = Math.max(distance(start, destination), 1);
  const threshold = {
    x: start.x + ((destination.x - start.x) / span) * 9,
    y: start.y + ((destination.y - start.y) / span) * 9,
  };
  const press = options.settle;
  const crossing = after(press + options.pressHold, moveSteps(start, [threshold], 160, "out", true));
  const carry = after(end(crossing) + 80, moveSteps(threshold, [...options.via, destination], options.ms, options.ease, true));
  const release = end(carry) + options.hold;
  return [
    { ms: press, type: "down", button: "left", clicks: 1, modifiers: [] },
    ...crossing,
    ...carry,
    { ms: release, type: "up", button: "left", clicks: 1, modifiers: [] },
  ];
}

export function scrollSteps(dy: number, dx: number, unit: "line" | "pixel", times: number, interval: number): InputStep[] {
  return Array.from({ length: Math.max(times, 1) }, (_, i) => ({ ms: i * interval, type: "scroll" as const, dy, dx, unit }));
}

export function keySteps(code: number, modifiers: Modifier[]): InputStep[] {
  return [
    { ms: 0, type: "key", code, down: true, modifiers },
    { ms: 8, type: "key", code, down: false, modifiers },
  ];
}
