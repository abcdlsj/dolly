// How Studio names things in its labels.

import type { Move } from "@dolly/core";
import { FORMATS, type Film } from "../model/types.ts";

export const MOVE_NAME: Record<Move, string> = {
  hold: "Hold",
  focus: "Focus",
  frame: "Frame",
  "pull-back": "Pull back",
  "pan-to": "Pan across",
  "punch-in": "Push in",
  drift: "Drift",
  tour: "Tour",
};

/** The film's line once Dolly has one; until then, the app's name. */
export function filmTitle(film: Film): string {
  return film.line || `${film.app.name} film`;
}

/** “Landscape and Portrait”. */
export function shapes(film: Film): string {
  const names = film.formats.map((id) => FORMATS.find((format) => format.id === id)?.shape ?? id);
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

export function money(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}

/** Splits the line for captions: “Write anywhere.” and “Even offline.” */
export function sentences(line: string): string[] {
  return line.match(/[^.!?]+[.!?]*/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
}
