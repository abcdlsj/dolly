import { describe, expect, test } from "bun:test";
import { SimulatedDirector } from "../src/agent/simulated.ts";
import { Store } from "../src/model/store.ts";
import { FakeClock, MARGIN, until } from "./helpers.ts";

function setup() {
  const clock = new FakeClock();
  const store = new Store(clock.now);
  const director = new SimulatedDirector(clock);
  director.attach(store);
  return { clock, store, director };
}

describe("SimulatedDirector", () => {
  test("plays a whole film, and the unanswered question goes with Dolly's pick", async () => {
    const { store } = setup();
    const id = store.create({ app: MARGIN, formats: ["website", "social"], length: 30, ask: "key", notes: "" });
    await until(() => store.film(id)!.question !== null);
    const question = store.film(id)!.question!;
    expect(question.text).toContain("sample notes");
    expect(question.seconds).toBe(40);
    await until(() => store.film(id)!.stage === "ready");
    const film = store.film(id)!;
    expect(film.line).toBe("Write anywhere. Even offline.");
    expect(film.shots.every((shot) => shot.state === "done")).toBe(true);
    expect(film.screens.filter((screen) => screen.picked).length).toBe(3);
    expect(film.outputs).toHaveLength(2);
  });

  test("answering goes on at once", async () => {
    const { store, clock } = setup();
    const id = store.create({ app: MARGIN, formats: ["website"], length: 30, ask: "key", notes: "" });
    await until(() => store.film(id)!.question !== null);
    const asked = clock.now();
    store.answer(id, "1");
    await until(() => store.film(id)!.shots[3]!.state === "live");
    expect(clock.now() - asked).toBeLessThan(1000);
  });

  test("“Before filming” waits for a direction with no countdown", async () => {
    const { store } = setup();
    const id = store.create({ app: MARGIN, formats: ["website"], length: 30, ask: "before", notes: "" });
    await until(() => store.film(id)!.question !== null);
    const question = store.film(id)!.question!;
    expect(question.deadline).toBeNull();
    store.answer(id, "2");
    await until(() => store.film(id)!.line !== "");
    expect(store.film(id)!.line).toBe("Your notes, on every device.");
  });

  test("a paused film does not move", async () => {
    const { store } = setup();
    const id = store.create({ app: MARGIN, formats: ["website"], length: 30, ask: "stuck", notes: "" });
    await until(() => store.film(id)!.screens.length === 2);
    store.pause(id);
    await until(() => false, 2000).catch(() => {});
    expect(store.film(id)!.screens.length).toBe(2);
    store.resume(id);
    await until(() => store.film(id)!.stage === "ready");
  });

  test("a change asked of a finished film films the last shot again", async () => {
    const { store } = setup();
    const id = store.create({ app: MARGIN, formats: ["website"], length: 30, ask: "stuck", notes: "" });
    await until(() => store.film(id)!.stage === "ready");
    store.message(id, "end on the logo a bit longer");
    expect(store.film(id)!.version).toBe(2);
    await until(() => store.film(id)!.stage === "ready");
    expect(store.film(id)!.shots.at(-1)!.take).toBe(2);
  });
});
