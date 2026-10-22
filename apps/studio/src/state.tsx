// What screens see: a read-only snapshot plus the actions. The main window
// holds the real Store; other windows (glance panel, menu bar panel,
// settings) hold a RemoteStudio that mirrors it over the bridge.

import { createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import type { NewFilm, Snapshot } from "./model/store.ts";
import type { Settings } from "./model/types.ts";

export interface Studio {
  snapshot(): Snapshot;
  subscribe(listener: () => void): () => void;
  create(input: NewFilm): string;
  restart(filmId: string): void;
  answer(filmId: string, optionId: string): void;
  pause(filmId: string): void;
  resume(filmId: string): void;
  takeOver(filmId: string): void;
  retake(filmId: string, shotId: string): void;
  changeDirection(filmId: string, line: string): void;
  message(filmId: string, text: string): void;
  remove(filmId: string): void;
  updateSettings(change: Partial<Settings>): void;
}

export type Action = { [K in Exclude<keyof Studio, "snapshot" | "subscribe">]: { name: K; args: Parameters<Studio[K]> } }[Exclude<keyof Studio, "snapshot" | "subscribe">];

const StudioContext = createContext<Studio | null>(null);

export function StudioProvider({ studio, children }: { studio: Studio; children: ReactNode }) {
  return <StudioContext.Provider value={studio}>{children}</StudioContext.Provider>;
}

export function useStudio(): Studio {
  const studio = useContext(StudioContext);
  if (!studio) throw new Error("useStudio outside StudioProvider");
  return studio;
}

export function useSnapshot(): Snapshot {
  const studio = useStudio();
  return useSyncExternalStore(studio.subscribe, () => studio.snapshot());
}

/** The current time, refreshed every `ms`; drives countdowns. */
export function useNow(ms = 500): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}
