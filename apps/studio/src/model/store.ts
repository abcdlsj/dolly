// The one place Studio's state lives. Screens read it and call actions; the
// director (fake or pi) listens for what the person asked and writes back.

import { DEFAULT_SETTINGS, type AskLevel, type Film, type FormatId, type Length, type Question, type Settings, type Shot } from "./types.ts";

export type Request =
  | { type: "start"; filmId: string }
  | { type: "answer"; filmId: string; questionId: string; optionId: string }
  | { type: "pause"; filmId: string }
  | { type: "resume"; filmId: string }
  | { type: "takeover"; filmId: string }
  | { type: "retake"; filmId: string; shotId: string }
  | { type: "direction"; filmId: string; line: string }
  | { type: "message"; filmId: string; text: string }
  | { type: "remove"; filmId: string };

export interface NewFilm {
  app: Film["app"];
  formats: FormatId[];
  length: Length;
  ask: AskLevel;
  notes: string;
}

export interface Snapshot {
  films: Film[];
  settings: Settings;
}

type Listener = () => void;
type RequestListener = (request: Request) => void;

let counter = 0;
const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export class Store {
  private films: Film[] = [];
  private settingsValue: Settings = { ...DEFAULT_SETTINGS };
  private listeners = new Set<Listener>();
  private requestListeners = new Set<RequestListener>();
  private snapshotCache: Snapshot | null = null;

  constructor(private now: () => number = Date.now) {}

  // Reading

  snapshot(): Snapshot {
    this.snapshotCache ??= { films: this.films, settings: this.settingsValue };
    return this.snapshotCache;
  }

  film(id: string): Film | undefined {
    return this.films.find((film) => film.id === id);
  }

  get settings(): Settings {
    return this.settingsValue;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  onRequest(listener: RequestListener): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  /** Restores saved state. A film that was still being made has lost its agent, so it says so. */
  load(snapshot: Snapshot): void {
    this.films = snapshot.films.map((film) =>
      film.stage === "ready" || film.error ? film : { ...film, question: null, paused: false, heldByYou: false, error: "Dolly was closed before this film was finished." },
    );
    this.settingsValue = { ...DEFAULT_SETTINGS, ...snapshot.settings };
    this.changed();
  }

  // Writing, for the director

  patch(id: string, change: Partial<Film> | ((film: Film) => Partial<Film>)): void {
    this.films = this.films.map((film) => {
      if (film.id !== id) return film;
      const next = { ...film, ...(typeof change === "function" ? change(film) : change) };
      if (next.stage === "ready" && next.finishedAt === null) next.finishedAt = this.now();
      return next;
    });
    this.changed();
  }

  patchShot(id: string, shotId: string, change: Partial<Shot>): void {
    this.patch(id, (film) => ({ shots: film.shots.map((shot) => (shot.id === shotId ? { ...shot, ...change } : shot)) }));
  }

  ask(id: string, question: Omit<Question, "id"> & { id?: string }): string {
    const full: Question = { ...question, id: question.id ?? newId("q") };
    this.patch(id, { question: full });
    return full.id;
  }

  // Actions, for the screens

  create(input: NewFilm): string {
    const film: Film = {
      id: newId("film"),
      app: input.app,
      createdAt: this.now(),
      finishedAt: null,
      formats: input.formats.length ? input.formats : ["website"],
      length: input.length,
      ask: input.ask,
      notes: input.notes.trim(),
      stage: "explore",
      line: "",
      why: "",
      alternatives: [],
      screens: [],
      shots: [],
      question: null,
      doing: "Opening a private copy of " + input.app.name,
      frame: null,
      outputs: [],
      paused: false,
      heldByYou: false,
      steps: 0,
      cost: 0,
      etaMinutes: null,
      version: 1,
      error: null,
    };
    this.films = [film, ...this.films];
    this.changed();
    this.request({ type: "start", filmId: film.id });
    return film.id;
  }

  /** Starts a film over from the beginning, with the same app and choices. */
  restart(filmId: string): void {
    const film = this.film(filmId);
    if (!film) return;
    this.patch(filmId, {
      stage: "explore", line: "", why: "", alternatives: [], screens: [], shots: [], question: null,
      doing: "Opening a private copy of " + film.app.name, frame: null, outputs: [], paused: false, heldByYou: false,
      etaMinutes: null, error: null, finishedAt: null,
    });
    this.request({ type: "start", filmId });
  }

  answer(filmId: string, optionId: string): void {
    const question = this.film(filmId)?.question;
    if (!question || !question.options.some((option) => option.id === optionId)) return;
    this.patch(filmId, { question: null });
    this.request({ type: "answer", filmId, questionId: question.id, optionId });
  }

  /** Called on every tick; answers with Dolly's pick once a question's time is up. */
  expire(): void {
    const now = this.now();
    for (const film of this.films) {
      const question = film.question;
      if (question?.deadline != null && question.deadline >= 0 && question.deadline <= now && !film.paused && !film.heldByYou) {
        this.answer(film.id, question.recommended);
      }
    }
  }

  pause(filmId: string): void {
    if (this.film(filmId)?.paused) return;
    this.patch(filmId, (film) => ({ paused: true, question: film.question && pauseClock(film.question, this.now()) }));
    this.request({ type: "pause", filmId });
  }

  resume(filmId: string): void {
    const film = this.film(filmId);
    if (!film || (!film.paused && !film.heldByYou)) return;
    this.patch(filmId, { paused: false, heldByYou: false, question: film.question && resumeClock(film.question, this.now()) });
    this.request({ type: "resume", filmId });
  }

  takeOver(filmId: string): void {
    const film = this.film(filmId);
    if (!film || film.heldByYou || film.stage === "ready") return;
    this.patch(filmId, { heldByYou: true, question: film.question && pauseClock(film.question, this.now()) });
    this.request({ type: "takeover", filmId });
  }

  retake(filmId: string, shotId: string): void {
    const film = this.film(filmId);
    if (!film?.shots.some((shot) => shot.id === shotId)) return;
    this.patch(filmId, (current) => ({
      stage: current.stage === "ready" ? "filming" : current.stage,
      version: current.stage === "ready" ? current.version + 1 : current.version,
      shots: current.shots.map((shot) => (shot.id === shotId ? { ...shot, state: "retake" } : shot)),
    }));
    this.request({ type: "retake", filmId, shotId });
  }

  changeDirection(filmId: string, line: string): void {
    this.request({ type: "direction", filmId, line });
  }

  message(filmId: string, text: string): void {
    const trimmed = text.trim();
    if (trimmed) this.request({ type: "message", filmId, text: trimmed });
  }

  remove(filmId: string): void {
    this.request({ type: "remove", filmId });
    this.films = this.films.filter((film) => film.id !== filmId);
    this.changed();
  }

  updateSettings(change: Partial<Settings>): void {
    this.settingsValue = { ...this.settingsValue, ...change };
    this.changed();
  }

  private request(request: Request): void {
    for (const listener of this.requestListeners) listener(request);
  }

  private changed(): void {
    this.snapshotCache = null;
    for (const listener of this.listeners) listener();
  }
}

// A paused question keeps its remaining time in `deadline` as a negative
// number of ms, so the countdown picks up where it stopped.
function pauseClock(question: Question, now: number): Question {
  if (question.deadline == null || question.deadline < 0) return question;
  return { ...question, deadline: -Math.max(0, question.deadline - now) };
}

function resumeClock(question: Question, now: number): Question {
  if (question.deadline == null || question.deadline >= 0) return question;
  return { ...question, deadline: now - question.deadline };
}

// Derived values the screens share.

export function needsYou(film: Film): boolean {
  return film.question !== null || film.error !== null;
}

export function secondsLeft(question: Question, now: number): number | null {
  if (question.deadline == null) return null;
  if (question.deadline < 0) return Math.ceil(-question.deadline / 1000);
  return Math.max(0, Math.ceil((question.deadline - now) / 1000));
}

export function liveShot(film: Film): Shot | undefined {
  return film.shots.find((shot) => shot.state === "live") ?? film.shots.find((shot) => shot.state === "retake");
}

export function shotNumber(film: Film, shotId: string | undefined): number {
  return film.shots.findIndex((shot) => shot.id === shotId) + 1;
}

export function progress(film: Film): number {
  const weights = { explore: 0, direction: 0.2, filming: 0.3, final: 0.9, ready: 1 };
  if (film.stage !== "filming" || film.shots.length === 0) return weights[film.stage];
  const done = film.shots.filter((shot) => shot.state === "done").length;
  return 0.3 + 0.6 * (done / film.shots.length);
}

export function statusLine(film: Film): string {
  if (film.error) return film.error;
  if (film.heldByYou) return "You have the controls";
  if (film.paused) return "Paused";
  if (film.question) return "Waiting for you";
  if (film.stage === "ready") return "Ready";
  if (film.stage === "filming") {
    const live = liveShot(film);
    return live ? `Shot ${shotNumber(film, live.id)} of ${film.shots.length}` : "Filming";
  }
  return { explore: "Exploring the app", direction: "Choosing a direction", final: "Making the final cut" }[film.stage];
}

export function etaText(film: Film): string {
  if (film.etaMinutes == null) return "";
  return film.etaMinutes <= 1 ? "About a minute left" : `About ${film.etaMinutes} min left`;
}
