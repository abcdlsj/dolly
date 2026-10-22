// Runs one pi agent per film over RPC and folds its stream into the store:
// `film` tool calls become stages, shots and the direction; `ask` plus the
// select request that follows becomes the question with its countdown; dolly
// commands run through bash count as steps.

import { MOVES, type Move } from "@dolly/core";
import type { FilmParams, AskParams } from "../../agent/studio-extension.ts";
import type { Request, Store } from "../model/store.ts";
import { FORMATS, type Film, type Settings, type Shot, type Stage } from "../model/types.ts";
import type { Clock, Director } from "./director.ts";
import { realClock } from "./director.ts";
import { encode, parse, type PiCommand, type PiEvent } from "./rpc.ts";

/** A running `pi --mode rpc` process. The platform layer spawns it. */
export interface PiProcess {
  send(line: string): void;
  onLine(listener: (line: string) => void): void;
  onExit(listener: (code: number | null) => void): void;
  kill(): void;
}

export type Spawn = (film: Film, settings: Settings) => Promise<PiProcess>;

export function brief(film: Film, settings: Settings): string {
  const formats = film.formats.map((id) => FORMATS.find((format) => format.id === id)).filter((format) => format !== undefined);
  const asks = {
    stuck: "Only ask when you cannot continue. Decide everything else yourself.",
    key: "Ask at key moments only: real data or accounts, a close call between directions, or a button with side effects. Always give a recommendation and a timeout of 30 to 90 seconds.",
    before: "Before filming, ask which direction to take (no timeout). After that, ask only at key moments, with a timeout.",
  }[film.ask];
  return [
    `Make a ${film.length}-second promo film for the app at ${film.app.path} (${film.app.name}).`,
    `Formats: ${formats.map((format) => `${format.name} ${format.aspect}`).join(", ")}.`,
    film.notes ? `Notes from the person: ${film.notes}` : "",
    settings.privateCopy ? "Launch it with `dolly launch --isolated` so the person's data is never touched." : "",
    settings.neverClick.length ? `Never click a control whose label contains any of: ${settings.neverClick.join(", ")}. Film something else instead.` : "",
    asks,
    "Work in stages: explore the app, settle one direction, write the shot list, film each shot, then cut every format.",
    "Report each step with the `film` tool in plain words. The person reads only what you send through `film` and `ask`.",
  ].filter(Boolean).join("\n");
}

interface Session {
  process: PiProcess;
  streaming: boolean;
  pendingAsks: Map<string, AskParams>;
}

export class PiDirector implements Director {
  private store!: Store;
  private sessions = new Map<string, Session>();

  constructor(private spawn: Spawn, private clock: Clock = realClock) {}

  attach(store: Store): () => void {
    this.store = store;
    const stopRequests = store.onRequest((request) => void this.handle(request));
    const timer = setInterval(() => store.expire(), 250);
    return () => {
      stopRequests();
      clearInterval(timer);
      for (const session of this.sessions.values()) session.process.kill();
      this.sessions.clear();
    };
  }

  private async handle(request: Request): Promise<void> {
    const film = this.store.film(request.filmId);
    if (!film) return;
    const session = this.sessions.get(film.id);
    switch (request.type) {
      case "start":
        this.sessions.delete(film.id);
        session?.process.kill();
        await this.open(film, brief(film, this.store.settings));
        break;
      case "answer": {
        const label = film.question?.options.find((option) => option.id === request.optionId)?.label
          ?? request.optionId;
        session && send(session, { type: "extension_ui_response", id: request.questionId, value: label });
        break;
      }
      case "pause":
      case "takeover":
        // Aborting kills the agent's running `dolly` command, which lets go of the mouse.
        session && send(session, { type: "abort" });
        break;
      case "resume":
        await this.say(film, "The person handed control back. Check the app's state with a snapshot, then continue the film from where you stopped.");
        break;
      case "retake": {
        const number = film.shots.findIndex((shot) => shot.id === request.shotId) + 1;
        await this.say(film, `Film shot ${number} (“${film.shots[number - 1]?.title}”) again; keep the other shots.`);
        break;
      }
      case "direction":
        await this.say(film, `Change the direction to: “${request.line}”. Rewrite the shot list for it and film the shots that change.`);
        break;
      case "message":
        await this.say(film, request.text);
        break;
      case "remove":
        this.sessions.delete(film.id);
        session?.process.kill();
        break;
    }
  }

  private async open(film: Film, prompt: string): Promise<void> {
    const process = await this.spawn(film, this.store.settings);
    const session: Session = { process, streaming: false, pendingAsks: new Map() };
    this.sessions.set(film.id, session);
    process.onLine((line) => {
      const event = parse(line);
      if (event) this.apply(film.id, session, event);
    });
    process.onExit((code) => {
      // A session replaced by a restart, or removed with its film, exits quietly.
      if (this.sessions.get(film.id) !== session) return;
      this.sessions.delete(film.id);
      const current = this.store.film(film.id);
      if (current && current.stage !== "ready" && !current.paused && !current.heldByYou) {
        this.store.patch(film.id, { error: code ? `The agent stopped (exit ${code}).` : "The agent stopped before the film was ready." });
      }
    });
    send(session, { type: "prompt", message: prompt });
  }

  private async say(film: Film, message: string): Promise<void> {
    const session = this.sessions.get(film.id);
    if (!session) return this.open(film, `${brief(film, this.store.settings)}\n\n${message}`);
    send(session, session.streaming ? { type: "prompt", message, streamingBehavior: "steer" } : { type: "prompt", message });
  }

  apply(filmId: string, session: Session, event: PiEvent): void {
    switch (event.type) {
      case "agent_start":
        session.streaming = true;
        break;
      case "agent_end":
        session.streaming = false;
        send(session, { type: "get_session_stats", id: "stats" });
        break;
      case "response":
        if (event.command === "get_session_stats" && event.success) {
          const cost = (event.data as { cost?: unknown } | undefined)?.cost;
          if (typeof cost === "number") this.store.patch(filmId, { cost: Math.round(cost * 100) / 100 });
        } else if (!event.success && event.command === "prompt") {
          this.store.patch(filmId, { error: event.error ?? "The agent could not start." });
        }
        break;
      case "tool_execution_start":
        this.store.patch(filmId, (film) => ({ steps: film.steps + 1 }));
        if (event.toolName === "film") this.applyFilm(filmId, event.args as FilmParams);
        else if (event.toolName === "ask") {
          const ask = event.args as unknown as AskParams;
          session.pendingAsks.set(ask.question, ask);
        }
        break;
      case "extension_ui_request":
        if (event.method === "select") {
          const ask = session.pendingAsks.get(event.title);
          session.pendingAsks.delete(event.title);
          const recommended = event.options[ask?.recommended ?? 0] ?? event.options[0] ?? "";
          const shot = ask?.shot ? this.store.film(filmId)?.shots[ask.shot - 1] : undefined;
          this.store.ask(filmId, {
            id: event.id,
            text: event.title,
            options: event.options.map((label) => ({ id: label, label })),
            recommended,
            deadline: event.timeout ? this.clock.now() + event.timeout : null,
            ...(event.timeout ? { seconds: Math.round(event.timeout / 1000) } : {}),
            ...(shot ? { shotId: shot.id } : {}),
          });
        } else if (event.method === "setStatus" && event.statusText) {
          this.store.patch(filmId, { doing: event.statusText });
        }
        break;
      default:
        break;
    }
  }

  private applyFilm(filmId: string, params: FilmParams): void {
    this.store.patch(filmId, (film): Partial<Film> => {
      const change: Partial<Film> = {};
      if (params.stage && isStage(params.stage)) change.stage = params.stage;
      if (params.doing) change.doing = params.doing;
      if (params.screen && !film.screens.some((screen) => screen.name === params.screen)) {
        change.screens = [...film.screens, { name: params.screen, picked: false }];
      }
      if (params.direction) {
        const picked = params.direction.picked ?? [];
        change.line = params.direction.line;
        change.why = params.direction.why;
        change.alternatives = params.direction.alternatives ?? [];
        change.screens = (change.screens ?? film.screens).map((screen) => ({ ...screen, picked: picked.includes(screen.name) }));
      }
      if (params.shots) {
        change.shots = params.shots.map((shot, index): Shot => {
          const old = film.shots[index];
          return {
            id: `shot-${index + 1}`,
            title: shot.title,
            move: toMove(shot.move),
            action: shot.action,
            why: shot.why,
            seconds: shot.seconds,
            state: old && old.title === shot.title ? old.state : "todo",
            take: old && old.title === shot.title ? old.take : 0,
          };
        });
      }
      if (params.shot) {
        const target = params.shot;
        change.shots = (change.shots ?? film.shots).map((shot, index) =>
          index === target.index - 1 ? { ...shot, state: target.state, take: target.state === "live" ? shot.take + 1 : shot.take } : shot,
        );
      }
      if (params.frame) change.frame = params.frame;
      if (params.outputs) change.outputs = params.outputs;
      if (change.stage === "ready") change.etaMinutes = null;
      return change;
    });
  }
}

function send(session: Session, command: PiCommand): void {
  session.process.send(encode(command));
}

function isStage(value: string): value is Stage {
  return ["explore", "direction", "filming", "final", "ready"].includes(value);
}

function toMove(value: string): Move {
  return (MOVES as readonly string[]).includes(value) ? (value as Move) : "focus";
}
