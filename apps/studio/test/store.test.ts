import { describe, expect, test } from "bun:test";
import { progress, secondsLeft, statusLine, Store, type Request } from "../src/model/store.ts";
import { MARGIN } from "./helpers.ts";

function setup() {
  let time = 1000;
  const store = new Store(() => time);
  const requests: Request[] = [];
  store.onRequest((request) => requests.push(request));
  const id = store.create({ app: MARGIN, formats: [], length: 30, ask: "key", notes: "  offline first  " });
  return { store, requests, id, tick: (ms: number) => (time += ms) };
}

describe("Store", () => {
  test("a new film asks the director to start, with defaults filled in", () => {
    const { store, requests, id } = setup();
    const film = store.film(id)!;
    expect(film.formats).toEqual(["website"]);
    expect(film.notes).toBe("offline first");
    expect(requests).toEqual([{ type: "start", filmId: id }]);
  });

  test("an unanswered question goes with Dolly's pick when time runs out", () => {
    const { store, requests, id, tick } = setup();
    const question = store.ask(id, { text: "Use samples?", options: [{ id: "a", label: "Use Samples" }, { id: "b", label: "Mine" }], recommended: "a", deadline: 1000 + 40_000, seconds: 40 });
    tick(39_000);
    store.expire();
    expect(store.film(id)!.question?.id).toBe(question);
    tick(1_000);
    store.expire();
    expect(store.film(id)!.question).toBeNull();
    expect(requests.at(-1)).toEqual({ type: "answer", filmId: id, questionId: question, optionId: "a" });
  });

  test("pausing stops the countdown where it was, resuming picks it up", () => {
    const { store, id, tick } = setup();
    store.ask(id, { text: "?", options: [{ id: "a", label: "A" }], recommended: "a", deadline: 1000 + 30_000 });
    tick(10_000);
    store.pause(id);
    expect(secondsLeft(store.film(id)!.question!, 0)).toBe(20);
    tick(60_000);
    store.expire();
    expect(store.film(id)!.question).not.toBeNull();
    store.resume(id);
    expect(secondsLeft(store.film(id)!.question!, 1000 + 70_000)).toBe(20);
  });

  test("taking over holds the film until it is handed back", () => {
    const { store, requests, id } = setup();
    store.takeOver(id);
    expect(store.film(id)!.heldByYou).toBe(true);
    expect(statusLine(store.film(id)!)).toBe("You have the controls");
    store.resume(id);
    expect(store.film(id)!.heldByYou).toBe(false);
    expect(requests.map((request) => request.type)).toEqual(["start", "takeover", "resume"]);
  });

  test("a retake of a finished film makes a new version", () => {
    const { store, id } = setup();
    store.patch(id, {
      stage: "ready",
      shots: [{ id: "s1", title: "One", move: "hold", action: "", why: "", seconds: 5, state: "done", take: 1 }],
    });
    expect(store.film(id)!.finishedAt).toBe(1000);
    store.retake(id, "s1");
    const film = store.film(id)!;
    expect(film.stage).toBe("filming");
    expect(film.version).toBe(2);
    expect(film.shots[0]!.state).toBe("retake");
  });

  test("progress follows the stage, then the shots filmed", () => {
    const { store, id } = setup();
    expect(progress(store.film(id)!)).toBe(0);
    store.patch(id, {
      stage: "filming",
      shots: [
        { id: "s1", title: "One", move: "hold", action: "", why: "", seconds: 5, state: "done", take: 1 },
        { id: "s2", title: "Two", move: "hold", action: "", why: "", seconds: 5, state: "todo", take: 0 },
      ],
    });
    expect(progress(store.film(id)!)).toBeCloseTo(0.6);
  });

  test("a film still being made when Studio quit says so after loading", () => {
    const { store, id } = setup();
    const saved = JSON.parse(JSON.stringify(store.snapshot()));
    const next = new Store();
    next.load(saved);
    expect(next.film(id)!.error).toContain("closed");
    next.restart(id);
    expect(next.film(id)!.error).toBeNull();
    expect(next.film(id)!.stage).toBe("explore");
  });
});
