import { describe, expect, test } from "bun:test";
import { PiDirector, brief, type PiProcess } from "../src/agent/pi.ts";
import { LineSplitter, encode, parse, piArgs } from "../src/agent/rpc.ts";
import { Store } from "../src/model/store.ts";
import { FakeClock, MARGIN, until } from "./helpers.ts";

class FakePi implements PiProcess {
  sent: Record<string, unknown>[] = [];
  private lines = new Set<(line: string) => void>();
  private exits = new Set<(code: number | null, stderr: string) => void>();
  killed = false;

  send(line: string) {
    this.sent.push(JSON.parse(line));
  }
  onLine(listener: (line: string) => void) {
    this.lines.add(listener);
  }
  onExit(listener: (code: number | null, stderr: string) => void) {
    this.exits.add(listener);
  }
  kill() {
    this.killed = true;
  }
  emit(event: Record<string, unknown>) {
    for (const listener of this.lines) listener(JSON.stringify(event));
  }
  exit(code: number | null, stderr = "") {
    for (const listener of this.exits) listener(code, stderr);
  }
}

function setup() {
  const clock = new FakeClock();
  const store = new Store(clock.now);
  const processes: FakePi[] = [];
  let released = 0;
  const director = new PiDirector(async () => {
    const process = new FakePi();
    processes.push(process);
    return process;
  }, clock, async () => void released++);
  const stop = director.attach(store);
  return { clock, store, processes, stop, released: () => released };
}

const tool = (toolName: string, args: Record<string, unknown>) => ({ type: "tool_execution_start", toolCallId: `call-${toolName}`, toolName, args });

describe("pi RPC", () => {
  test("records end at \\n only, and a trailing \\r is dropped", () => {
    const splitter = new LineSplitter();
    expect(splitter.push('{"type":"agent_start"}\r\n{"type":"ag')).toEqual(['{"type":"agent_start"}']);
    expect(splitter.push('ent_end","note":"a b"}\n')).toEqual(['{"type":"agent_end","note":"a b"}']);
  });

  test("unknown or broken lines are not events", () => {
    expect(parse("not json")).toBeNull();
    expect(parse('{"type":"agent_end"}')).toEqual({ type: "agent_end" });
    expect(parse('{"type":"message_update"}')?.type).toBe("other");
  });

  test("encode writes one line", () => {
    expect(encode({ type: "abort" })).toBe('{"type":"abort"}\n');
  });

  test("pi gets the skill, the extension, and the model unless it is the recommended one", () => {
    const args = piArgs({ skill: "/r/skills/dolly", extension: "/r/agent/studio-extension.ts", sessionDir: "/s/f1", provider: "anthropic", model: "Recommended" });
    expect(args).toEqual(["--mode", "rpc", "--tools", "read,bash", "--skill", "/r/skills/dolly", "-e", "/r/agent/studio-extension.ts", "--session-dir", "/s/f1", "--provider", "anthropic"]);
  });
});

describe("PiDirector", () => {
  test("the brief carries the person's choices and the safety rules", () => {
    const store = new Store();
    const id = store.create({ app: MARGIN, formats: ["website", "social"], length: 15, ask: "stuck", notes: "skip pricing" });
    const text = brief(store.film(id)!, store.settings);
    expect(text).toContain("15-second");
    expect(text).toContain("Website 16:9, Social 9:16");
    expect(text).toContain("skip pricing");
    expect(text).toContain("--isolated");
    expect(text).toContain("Delete, Buy");
    expect(text).toContain("Only ask when you cannot continue");
  });

  test("film tool calls become the stage, the direction and the shots", async () => {
    const { store, processes } = setup();
    const id = store.create({ app: MARGIN, formats: ["website"], length: 30, ask: "key", notes: "" });
    await until(() => processes.length === 1);
    const pi = processes[0]!;
    expect(pi.sent[0]).toMatchObject({ type: "prompt" });
    pi.emit(tool("film", { stage: "explore", screen: "Editor", doing: "Opening the editor" }));
    pi.emit(tool("film", {
      stage: "direction",
      direction: { line: "Write anywhere. Even offline.", why: "It merges.", alternatives: ["Fast search."], picked: ["Editor"] },
      shots: [
        { title: "Airplane mode", move: "drift", action: "Turning it on", why: "Still start.", seconds: 5 },
        { title: "Get Margin", move: "zoom-wildly", action: "Logo", why: "End.", seconds: 4 },
      ],
    }));
    pi.emit(tool("film", { stage: "filming", shot: { index: 1, state: "live" } }));
    const film = store.film(id)!;
    expect(film.stage).toBe("filming");
    expect(film.screens).toEqual([{ name: "Editor", picked: true }]);
    expect(film.shots.map((shot) => [shot.move, shot.state, shot.take])).toEqual([["drift", "live", 1], ["focus", "todo", 0]]);
    expect(film.steps).toBe(3);
  });

  test("an ask becomes the question; the answer goes back as the option's label", async () => {
    const { store, processes, clock } = setup();
    const id = store.create({ app: MARGIN, formats: ["website"], length: 30, ask: "key", notes: "" });
    await until(() => processes.length === 1);
    const pi = processes[0]!;
    pi.emit(tool("film", { shots: [{ title: "A", move: "hold", action: "", why: "", seconds: 4 }, { title: "B", move: "tour", action: "", why: "", seconds: 6 }] }));
    pi.emit(tool("ask", { question: "Use samples?", options: ["Use Samples", "Use My Folder…"], recommended: 0, seconds: 40, shot: 2 }));
    pi.emit({ type: "extension_ui_request", id: "ui-7", method: "select", title: "Use samples?", options: ["Use Samples", "Use My Folder…"], timeout: 40_000 });
    const question = store.film(id)!.question!;
    expect(question).toMatchObject({ id: "ui-7", recommended: "Use Samples", seconds: 40, shotId: "shot-2", deadline: clock.now() + 40_000 });
    store.answer(id, "Use My Folder…");
    expect(pi.sent.at(-1)).toEqual({ type: "extension_ui_response", id: "ui-7", value: "Use My Folder…" });
  });

  test("pause aborts and lets go of the mouse; a change while it works is a steer", async () => {
    const { store, processes, released } = setup();
    const id = store.create({ app: MARGIN, formats: ["website"], length: 30, ask: "key", notes: "" });
    await until(() => processes.length === 1);
    const pi = processes[0]!;
    pi.emit({ type: "agent_start" });
    store.message(id, "skip the pricing screen");
    await until(() => pi.sent.length === 2);
    expect(pi.sent[1]).toEqual({ type: "prompt", message: "skip the pricing screen", streamingBehavior: "steer" });
    store.pause(id);
    await until(() => pi.sent.length === 3);
    expect(pi.sent[2]).toEqual({ type: "abort" });
    await until(() => released() === 1);
  });

  test("the agent quitting early shows an error; starting again opens a new agent", async () => {
    const { store, processes } = setup();
    const id = store.create({ app: MARGIN, formats: ["website"], length: 30, ask: "key", notes: "" });
    await until(() => processes.length === 1);
    processes[0]!.exit(1);
    expect(store.film(id)!.error).toContain("exit 1");
    store.restart(id);
    await until(() => processes.length === 2);
    expect(store.film(id)!.error).toBeNull();
  });

  test("the session cost arrives after each turn", async () => {
    const { store, processes } = setup();
    const id = store.create({ app: MARGIN, formats: ["website"], length: 30, ask: "key", notes: "" });
    await until(() => processes.length === 1);
    const pi = processes[0]!;
    pi.emit({ type: "agent_end" });
    expect(pi.sent.at(-1)).toMatchObject({ type: "get_session_stats" });
    pi.emit({ type: "response", command: "get_session_stats", success: true, data: { cost: 0.5812 } });
    expect(store.film(id)!.cost).toBe(0.58);
  });
});
