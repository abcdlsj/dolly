// One eased value over time: a cubic per gap between keyframes.

import { CAMERA_EASES, type CameraEase } from "./eases.ts";
import { clamp } from "./geometry.ts";

type Cubic = readonly [number, number, number, number];

export class Segment {
  constructor(
    readonly start: number,
    readonly end: number,
    readonly coefficients: Cubic,
  ) {}

  at(t: number): number {
    const u = clamp((t - this.start) / Math.max(this.end - this.start, 1e-6), 0, 1);
    const [c0, c1, c2, c3] = this.coefficients;
    return c0 + u * (c1 + u * (c2 + u * c3));
  }
}

export class Channel {
  constructor(
    readonly first: number,
    readonly segments: readonly Segment[],
  ) {}

  /** `eases[i]` is how the value arrives at keyframe i from keyframe i - 1. */
  static build(times: readonly number[], values: readonly number[], eases: readonly CameraEase[]): Channel {
    const slopes = tangents(times, values, eases);
    const segments: Segment[] = [];
    for (let i = 0; i < times.length - 1; i++) {
      const t0 = times[i]!;
      const t1 = times[i + 1]!;
      const a = values[i]!;
      const b = values[i + 1]!;
      const ease = eases[i + 1]!;
      let c: Cubic;
      if (ease === "spline") {
        const h = t1 - t0;
        const m0 = slopes[i]! * h;
        const m1 = slopes[i + 1]! * h;
        c = [a, m0, -3 * a - 2 * m0 + 3 * b - m1, 2 * a + m0 - 2 * b + m1];
      } else {
        const f = CAMERA_EASES[ease];
        c = [a + (b - a) * f[0], (b - a) * f[1], (b - a) * f[2], (b - a) * f[3]];
      }
      segments.push(new Segment(t0, t1, c));
    }
    return new Channel(values[0]!, segments);
  }

  at(t: number): number {
    const first = this.segments[0];
    if (!first || t <= first.start) return this.first;
    for (const segment of this.segments) if (t < segment.end) return segment.at(t);
    const last = this.segments[this.segments.length - 1]!;
    return last.at(last.end);
  }

  /** The same curve as one ffmpeg expression of `clock`. */
  expression(clock = "t"): string {
    const last = this.segments[this.segments.length - 1];
    if (!last) return fixed(this.first, 6);
    let expression = fixed(last.at(last.end), 6);
    for (const segment of [...this.segments].reverse()) {
      const span = Math.max(segment.end - segment.start, 1e-6);
      const u = `clip((${clock}-${segment.start.toFixed(4)})/${span.toFixed(4)},0,1)`;
      const [c0, c1, c2, c3] = segment.coefficients.map((c) => fixed(c, 6));
      const cubic = `(${c0}+${u}*(${c1}+${u}*(${c2}+${u}*${c3})))`;
      expression = `if(lt(${clock},${segment.end.toFixed(4)}),${cubic},${expression})`;
    }
    return expression;
  }
}

/** `toFixed` that keeps the sign of -0, as Python's `:.6f` does, so graphs match byte for byte. */
function fixed(value: number, digits: number): string {
  return Object.is(value, -0) ? `-${(0).toFixed(digits)}` : value.toFixed(digits);
}

/**
 * Monotone (PCHIP) slopes at each keyframe, zero at the ends. A keyframe the
 * camera holds on, turns back at, or that borders a non-spline segment gets
 * slope zero, so the spline never overshoots and a hold really holds.
 */
export function tangents(times: readonly number[], values: readonly number[], eases: readonly CameraEase[]): number[] {
  const slopes = new Array<number>(times.length).fill(0);
  for (let i = 1; i < times.length - 1; i++) {
    if (eases[i] !== "spline" || eases[i + 1] !== "spline") continue;
    const h0 = times[i]! - times[i - 1]!;
    const h1 = times[i + 1]! - times[i]!;
    if (h0 <= 0 || h1 <= 0) continue;
    const d0 = (values[i]! - values[i - 1]!) / h0;
    const d1 = (values[i + 1]! - values[i]!) / h1;
    if (d0 * d1 <= 0) continue;
    const w0 = 2 * h1 + h0;
    const w1 = h1 + 2 * h0;
    slopes[i] = (w0 + w1) / (w0 / d0 + w1 / d1);
  }
  return slopes;
}
