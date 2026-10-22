import { MOVES } from "@dolly/core";
import { describe, expect, test } from "bun:test";
import { at, duration, frameRect, timeline, transform, viewOf } from "../src/preview/camera.ts";
import { Store } from "../src/model/store.ts";
import { MARGIN } from "./helpers.ts";

describe("camera preview", () => {
  test("every move plans with the core camera and stays on the canvas", () => {
    for (const move of MOVES) {
      for (const t of [0, 2.5, 5]) {
        const [zoom, x, y] = viewOf({ move, seconds: 5 }, t);
        expect(zoom).toBeGreaterThanOrEqual(1);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(1);
      }
    }
  });

  test("a push in ends closer than it starts", () => {
    expect(viewOf({ move: "punch-in", seconds: 8 }, 8)[0]).toBeGreaterThan(viewOf({ move: "punch-in", seconds: 8 }, 0)[0]);
    expect(viewOf({ move: "pull-back", seconds: 4 }, 4)[0]).toBeLessThan(viewOf({ move: "pull-back", seconds: 4 }, 0)[0]);
  });

  test("the timeline lays shots end to end and the player finds the shot at any time", () => {
    const store = new Store();
    const id = store.create({ app: MARGIN, formats: ["website"], length: 30, ask: "key", notes: "" });
    store.patch(id, {
      shots: [
        { id: "a", title: "A", move: "hold", action: "", why: "", seconds: 5, state: "done", take: 1 },
        { id: "b", title: "B", move: "punch-in", action: "", why: "", seconds: 8, state: "done", take: 1 },
      ],
    });
    const film = store.film(id)!;
    expect(timeline(film).map((placed) => [placed.start, placed.end])).toEqual([[0, 5], [5, 13]]);
    expect(duration(film)).toBe(13);
    expect(at(film, 6)?.placed.shot.id).toBe("b");
    expect(at(film, 99)?.placed.shot.id).toBe("b");
  });

  test("the framing corners and the transform describe the same view", () => {
    expect(frameRect([2, 0.5, 0.5])).toEqual({ left: 25, top: 25, width: 50, height: 50 });
    expect(transform([1, 0.5, 0.5])).toBe("scale(1.0000) translate(0.000%, 0.000%)");
  });
});
