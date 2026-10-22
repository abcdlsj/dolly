// A scripted run with the same shape as a real one: explore, settle on a
// direction, film shot by shot (asking once), cut, done. Pausing, taking over,
// answering, retakes and new directions all behave as they will with pi.

import type { Move } from "@dolly/core";
import type { Request, Store } from "../model/store.ts";
import type { AppRef, Shot } from "../model/types.ts";
import { realClock, type Clock, type Director } from "./director.ts";

interface ShotScript {
  title: string;
  move: Move;
  action: string;
  why: string;
  seconds: number;
  /** Ask this before filming the shot. */
  ask?: { text: string; options: [string, string]; seconds: number };
}

export interface Script {
  screens: string[];
  picked: string[];
  line: string;
  why: string;
  alternatives: string[];
  shots: ShotScript[];
}

export function scriptFor(app: AppRef): Script {
  if (app.name === "Margin") {
    return {
      screens: ["Editor", "Search", "Airplane mode", "Conflict dialog", "Share sheet", "Sync settings", "Themes", "Export", "Pricing"],
      picked: ["Conflict dialog", "Search", "Airplane mode"],
      line: "Write anywhere. Even offline.",
      why: "Edits made offline on two devices merge on their own. Of the 9 screens Dolly tried, this is the one that sets Margin apart, and it still reads on a phone.",
      alternatives: ["2,000 notes, found instantly.", "Your notes, on every device."],
      shots: [
        { title: "Airplane mode", move: "drift", action: "Turning on airplane mode", why: "Starts still so the offline switch registers.", seconds: 5 },
        { title: "Two devices", move: "pan-to", action: "Editing the same note on two devices", why: "Shows both edits before they meet.", seconds: 7 },
        { title: "Conflict, solved", move: "punch-in", action: "Dragging the conflict to “Keep both”", why: "Moves closer so “Keep both” reads in the portrait cut.", seconds: 8 },
        {
          title: "Instant search", move: "tour", action: "Searching 2,000 notes for “Lisbon”", why: "Visits three results in a row so the speed is felt.", seconds: 6,
          ask: { text: "Shot 4 needs a full library. Use 2,000 sample notes?", options: ["Use Samples", "Use My Folder…"], seconds: 40 },
        },
        { title: "Get Margin", move: "pull-back", action: "Pulling back to the logo", why: "Opens up to the logo and download link.", seconds: 4 },
      ],
    };
  }
  const name = app.name;
  return {
    screens: ["Home", "Create", "Search", "Settings", "Share"],
    picked: ["Home", "Create", "Share"],
    line: `${name}, at its best.`,
    why: `The create flow is the fastest path to what ${name} does well, and it reads at both sizes.`,
    alternatives: [`Everything in ${name}, in one place.`],
    shots: [
      { title: "First look", move: "focus", action: `Opening ${name}`, why: "Sets the scene before anything moves.", seconds: 5 },
      { title: "Make something", move: "punch-in", action: "Creating the first item", why: "Closer, so the key control is readable.", seconds: 8 },
      { title: "Share it", move: "pan-to", action: "Sharing the result", why: "Ends on the payoff.", seconds: 6 },
      { title: `Get ${name}`, move: "pull-back", action: "Pulling back to the logo", why: "Opens up to the logo.", seconds: 4 },
    ],
  };
}

export class SimulatedDirector implements Director {
  private store!: Store;
  private runs = new Map<string, Run>();

  constructor(private clock: Clock = realClock, private speed = 1) {}

  attach(store: Store): () => void {
    this.store = store;
    const stopRequests = store.onRequest((request) => this.handle(request));
    return () => {
      stopRequests();
      for (const run of this.runs.values()) run.cancelled = true;
      this.runs.clear();
    };
  }

  /** Resolves once the film's current run has finished; for tests. */
  done(filmId: string): Promise<void> {
    return this.runs.get(filmId)?.finished ?? Promise.resolve();
  }

  private handle(request: Request): void {
    const run = this.runs.get(request.filmId);
    switch (request.type) {
      case "start":
        this.start(request.filmId);
        break;
      case "answer":
        run?.answers.get(request.questionId)?.(request.optionId);
        break;
      case "retake":
        if (!run || run.finishedAt !== null) this.start(request.filmId, { from: "filming" });
        break;
      case "direction":
        if (run) run.cancelled = true;
        this.store.patch(request.filmId, (film) => ({
          line: request.line,
          alternatives: [film.line, ...film.alternatives.filter((alt) => alt !== request.line)].filter(Boolean),
          shots: film.shots.map((shot) => ({ ...shot, state: "todo" as const })),
          question: null,
          stage: "filming",
        }));
        this.start(request.filmId, { from: "filming" });
        break;
      case "message": {
        const film = this.store.film(request.filmId);
        const last = film?.shots.at(-1);
        // A change asked of a finished film: the script films the last shot again.
        if (film?.stage === "ready" && last) this.store.retake(film.id, last.id);
        else this.store.patch(request.filmId, (current) => ({ steps: current.steps + 1, doing: `Noted: “${request.text}”` }));
        break;
      }
      case "remove":
        if (run) run.cancelled = true;
        this.runs.delete(request.filmId);
        break;
      case "takeover":
        this.store.patch(request.filmId, { doing: "Stopped. You have the mouse and keyboard." });
        break;
      case "pause":
      case "resume":
        break;
    }
  }

  private start(filmId: string, options: { from?: "filming" } = {}): void {
    const previous = this.runs.get(filmId);
    if (previous) previous.cancelled = true;
    const run = new Run();
    this.runs.set(filmId, run);
    run.finished = this.play(filmId, run, options.from).catch((error: unknown) => {
      if (error instanceof Cancelled) return;
      this.store.patch(filmId, { error: error instanceof Error ? error.message : String(error) });
    }).finally(() => {
      run.finishedAt = this.clock.now();
    });
  }

  private async play(filmId: string, run: Run, from?: "filming"): Promise<void> {
    const film = () => this.store.film(filmId) ?? cancel();
    const script = scriptFor(film().app);
    const wait = (seconds: number) => this.wait(filmId, run, seconds);
    const step = (doing: string, cost = 0.01) => this.store.patch(filmId, (f) => ({ doing, steps: f.steps + 1, cost: round2(f.cost + cost) }));

    if (from !== "filming") {
      this.store.patch(filmId, { stage: "explore", etaMinutes: 20 });
      for (const name of script.screens) {
        step(`Opening ${name}`);
        this.store.patch(filmId, (f) => ({ screens: [...f.screens, { name, picked: false }] }));
        await wait(1.2);
      }

      this.store.patch(filmId, { stage: "direction", doing: "Choosing what the film says", etaMinutes: 14 });
      await wait(2);
      let line = script.line;
      if (film().ask === "before") {
        const options = [script.line, ...script.alternatives];
        const answer = await this.ask(filmId, run, { text: "Which line should the film lead with?", options, recommended: 0, seconds: null });
        line = options[answer] ?? script.line;
      }
      this.store.patch(filmId, {
        line,
        why: script.why,
        alternatives: [script.line, ...script.alternatives].filter((alt) => alt !== line),
        screens: film().screens.map((screen) => ({ ...screen, picked: script.picked.includes(screen.name) })),
        shots: script.shots.map((shot, index): Shot => ({
          id: `shot-${index + 1}`, title: shot.title, move: shot.move, action: shot.action, why: shot.why, seconds: shot.seconds, state: "todo", take: 0,
        })),
      });
    }

    this.store.patch(filmId, { stage: "filming" });
    for (;;) {
      const current = film();
      const next = current.shots.find((shot) => shot.state === "retake") ?? current.shots.find((shot) => shot.state === "todo");
      if (!next) break;
      const index = current.shots.indexOf(next);
      const ask = script.shots[index]?.ask;
      if (ask && next.take === 0 && current.ask !== "stuck") {
        await this.ask(filmId, run, { text: ask.text, options: ask.options, recommended: 0, seconds: ask.seconds, shotId: next.id });
      }
      this.store.patchShot(filmId, next.id, { state: "live", take: next.take + 1 });
      const remaining = current.shots.filter((shot) => shot.state !== "done").length;
      this.store.patch(filmId, { etaMinutes: Math.max(1, remaining * 2) });
      step(next.action, 0.04);
      await wait(next.seconds * 0.8);
      this.store.patchShot(filmId, next.id, { state: "done" });
    }

    this.store.patch(filmId, { stage: "final", doing: "Cutting the landscape and portrait versions", etaMinutes: 1 });
    await wait(3);
    const done = film();
    const folder = `~/Movies/Dolly/${done.app.name}`;
    this.store.patch(filmId, {
      stage: "ready", doing: "", etaMinutes: null, question: null,
      outputs: done.formats.map((id) => `${folder}/${done.line.replace(/[/:]/g, "-")} (${id}, v${done.version}).mp4`),
    });
  }

  private async ask(
    filmId: string,
    run: Run,
    question: { text: string; options: string[]; recommended: number; seconds: number | null; shotId?: string },
  ): Promise<number> {
    const options = question.options.map((label, index) => ({ id: String(index), label }));
    const id = this.store.ask(filmId, {
      text: question.text,
      options,
      recommended: String(question.recommended),
      deadline: question.seconds === null ? null : this.clock.now() + question.seconds * 1000,
      ...(question.seconds === null ? {} : { seconds: question.seconds }),
      ...(question.shotId ? { shotId: question.shotId } : {}),
    });
    let answer: string | null = null;
    run.answers.set(id, (optionId) => (answer = optionId));
    while (answer === null) {
      if (run.cancelled || !this.store.film(filmId)) cancel();
      await this.clock.sleep(100);
      this.store.expire();
    }
    run.answers.delete(id);
    return Number(answer);
  }

  // Waits `seconds` of unpaused time, checking in small steps so a pause or
  // take-over holds the run where it is.
  private async wait(filmId: string, run: Run, seconds: number): Promise<void> {
    let left = (seconds * 1000) / this.speed;
    while (left > 0) {
      if (run.cancelled) cancel();
      const slice = Math.min(left, 100);
      await this.clock.sleep(slice);
      const film = this.store.film(filmId) ?? cancel();
      if (!film.paused && !film.heldByYou) left -= slice;
      this.store.expire();
    }
    if (run.cancelled) cancel();
  }
}

class Run {
  cancelled = false;
  finished: Promise<void> = Promise.resolve();
  finishedAt: number | null = null;
  answers = new Map<string, (optionId: string) => void>();
}

class Cancelled extends Error {}
function cancel(): never {
  throw new Cancelled();
}

const round2 = (value: number) => Math.round(value * 100) / 100;
