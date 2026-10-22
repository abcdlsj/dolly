import { describe, expect, test } from "bun:test";
import { parsePoint, POINTER_EASES, STEP_MS, travel } from "../src/index.ts";

describe("pointer travel", () => {
  test("samples every step and lands on the last point at exactly ms", () => {
    const samples = travel({ x: 0, y: 0 }, [{ x: 100, y: 0 }], 100);
    expect(samples.length).toBe(100 / STEP_MS + 1);
    expect(samples[0]).toEqual({ ms: 0, x: 0, y: 0 });
    expect(samples[samples.length - 1]).toEqual({ ms: 100, x: 100, y: 0 });
    for (let i = 1; i < samples.length; i++) expect(samples[i]!.ms).toBeGreaterThan(samples[i - 1]!.ms);
  });

  test("follows the ease", () => {
    const samples = travel({ x: 0, y: 0 }, [{ x: 200, y: 0 }], 400, "inOut");
    const middle = samples.find((s) => s.ms === 100)!;
    expect(middle.x).toBeCloseTo(200 * POINTER_EASES.inOut(0.25), 9);
  });

  test("eases distance across the whole polyline, not each leg", () => {
    // Two equal legs: halfway in time is the corner, and the pointer is still moving there.
    const samples = travel({ x: 0, y: 0 }, [{ x: 100, y: 0 }, { x: 100, y: 100 }], 200, "inOut");
    const at = (ms: number) => samples.find((s) => s.ms === ms)!;
    expect(at(100)).toEqual({ ms: 100, x: 100, y: 0 });
    expect(at(96).x).toBeLessThan(100);
    expect(at(104).y).toBeGreaterThan(0);
  });

  test("a zero-length move is one sample at the target", () => {
    expect(travel({ x: 5, y: 5 }, [{ x: 5, y: 5 }], 300)).toEqual([{ ms: 300, x: 5, y: 5 }]);
    expect(travel({ x: 0, y: 0 }, [{ x: 9, y: 9 }], 0)).toEqual([{ ms: 0, x: 9, y: 9 }]);
    expect(travel({ x: 0, y: 0 }, [], 300)).toEqual([]);
  });

  test("points parse from x,y or x y", () => {
    expect(parsePoint("640,420")).toEqual({ x: 640, y: 420 });
    expect(parsePoint("640 420")).toEqual({ x: 640, y: 420 });
    expect(parsePoint("640")).toBeNull();
    expect(parsePoint("a,b")).toBeNull();
  });
});
