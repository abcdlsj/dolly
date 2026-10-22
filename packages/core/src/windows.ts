// Window choice and control geometry, from what a driver reports.

import type { Control, Window } from "@dolly/protocol";

export type Frame = readonly [x: number, y: number, width: number, height: number];

export function frameOf(window: Window): Frame {
  return [window.x, window.y, window.width, window.height];
}

/**
 * The largest on-screen window of an app, the usual target for a film: the
 * window whose frame pointer coordinates are relative to.
 */
export function pickWindow(windows: readonly Window[], pid: number, size?: { width?: number; height?: number }): Window | null {
  let best: Window | null = null;
  for (const window of windows) {
    if (window.pid !== pid || !window.onScreen || window.layer !== 0) continue;
    if (size?.width !== undefined && Math.trunc(window.width) !== size.width) continue;
    if (size?.height !== undefined && Math.trunc(window.height) !== size.height) continue;
    if (!best || window.width * window.height > best.width * best.height) best = window;
  }
  return best;
}

/** The frontmost window under a point, the one a click would land on. `windows` is front to back. */
export function windowAt(windows: readonly Window[], x: number, y: number): Window | null {
  return (
    windows.find(
      (w) => w.onScreen && w.layer === 0 && w.width > 1 && x >= w.x && x < w.x + w.width && y >= w.y && y < w.y + w.height,
    ) ?? null
  );
}

/** A control with where to aim at it: its centre in screen points, and its frame as window fractions. */
export interface PlacedControl extends Control {
  i: number;
  center: [number, number];
  /** What a shot file's `focus` and `rect` take. */
  rect: [number, number, number, number];
}

export function placeControls(nodes: readonly Control[], window: Frame): PlacedControl[] {
  const [wx, wy, ww, wh] = window;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const r4 = (v: number) => Math.round(v * 10000) / 10000;
  return nodes.map((node, i) => {
    const [x, y, w, h] = node.frame;
    return {
      ...node,
      i,
      frame: [r1(x), r1(y), r1(w), r1(h)],
      center: [r1(x + w / 2), r1(y + h / 2)],
      rect: [r4((x - wx) / ww), r4((y - wy) / wh), r4(w / ww), r4(h / wh)],
    };
  });
}
