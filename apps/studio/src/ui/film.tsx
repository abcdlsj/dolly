// The pieces the film page, the floating panel and the menu bar panel share:
// footage with the camera preview, the filmstrip, and the question bar.

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { at, frameRect, transform, viewOf } from "../preview/camera.ts";
import { liveShot, secondsLeft, shotNumber } from "../model/store.ts";
import type { Film, Question, Shot } from "../model/types.ts";
import { Countdown, Cursor } from "./icons.tsx";
import { fileSrc, startLive, stopLive } from "../platform.ts";

/**
 * The app as it is now: the shell captures the window every 400 ms into one
 * PNG, and this reloads it. Empty when there is nothing to show.
 */
export function useLive(app: string, running: boolean): string {
  const [src, setSrc] = useState("");
  useEffect(() => {
    setSrc("");
    if (!running) return;
    let stop = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    void startLive(app).then((frame) => {
      if (!frame || stop) return;
      const tick = () => setSrc(`${fileSrc(frame.path)}&t=${Date.now()}`);
      tick();
      timer = setInterval(tick, 500);
    });
    return () => {
      stop = true;
      clearInterval(timer);
      void stopLive();
    };
  }, [app, running]);
  return src;
}

/** Seconds since mount, looping every `period` seconds; paused when `running` is false. */
export function useLoop(period: number, running = true): number {
  const [t, setT] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    if (!running) return;
    let frame = 0;
    const tick = (now: number) => {
      start.current ??= now;
      setT(((now - start.current) / 1000) % Math.max(period, 0.001));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [period, running]);
  return t;
}

function frameSrc(path: string): string {
  // The shell streams local files; a browser tab loads them straight.
  return fileSrc(path);
}

/** A stand-in for the app until there is a snapshot or footage to show. */
export function AppMock({ film, scale = 1 }: { film: Film; scale?: number }) {
  return (
    <div className="mock" style={{ fontSize: 15 * scale }} aria-hidden="true">
      <div className="bar" />
      <div className="side">
        <b>{film.app.name === "Margin" ? "Lisbon, day 2" : film.app.name}</b>
        <span>{film.app.name === "Margin" ? "Grocery list" : "Library"}</span>
        <span>{film.app.name === "Margin" ? "Q4 roadmap" : "Recent"}</span>
        <span>{film.app.name === "Margin" ? "Reading notes" : "Shared"}</span>
      </div>
      <div className="body">
        <h3>{film.app.name === "Margin" ? "Lisbon, day 2" : film.app.name}</h3>
        <i style={{ width: "92%" }} />
        <i style={{ width: "80%" }} />
        <i style={{ width: "86%" }} />
      </div>
      {film.app.name === "Margin" && (
        <div className="dialog">
          <strong>Two versions of this note</strong>
          <span style={{ color: "#6e6a75" }}>Edited on this Mac and on iPhone while offline.</span>
          <div className="row"><span>Keep both</span><span>Use this Mac</span></div>
        </div>
      )}
    </div>
  );
}

interface FootageProps {
  film: Film;
  width: number;
  /** Defaults to 16:9 of the width. */
  height?: number;
  /** The cut being played, like "9:16"; the camera frames for it. */
  aspect?: string;
  /** "live" shows Dolly's pointer and where the camera is heading; "player" shows what the camera shows. */
  mode: "live" | "player" | "still";
  /** Player time in seconds. */
  t?: number;
  caption?: string;
  rec?: boolean;
  /** The app as it is now; falls back to the last snapshot, then the drawing. */
  live?: string;
}

export function Footage({ film, width, height = Math.round((width * 9) / 16), aspect = "16:9", mode, t = 0, caption, rec, live: mirror }: FootageProps) {
  const live = liveShot(film);
  const loop = useLoop(live?.seconds ?? 6, mode === "live" && !!live && !film.paused && !film.heldByYou);
  const style: CSSProperties = { width, height, background: film.app.tint, boxShadow: "0 1px 2px rgba(0,0,0,0.08), 0 8px 30px rgba(0,0,0,0.08)" };

  let stage: CSSProperties | undefined;
  let corners: ReturnType<typeof frameRect> | null = null;
  if (mode === "player") {
    const placed = at(film, t, aspect);
    if (placed) stage = { transform: transform(placed.view) };
  } else if (mode === "live" && live) {
    corners = frameRect(viewOf(live, loop));
  }

  return (
    <div className="footage" style={style}>
      <div className="stage" style={stage}>
        {mirror ? (
          <img className="snap" src={mirror} alt="" />
        ) : film.frame ? (
          <img className="snap" src={frameSrc(film.frame)} alt="" />
        ) : (
          <AppMock film={film} scale={width / 864} />
        )}
      </div>
      {corners && (
        <div className="corners" aria-hidden="true" style={{ left: `${corners.left}%`, top: `${corners.top}%`, width: `${corners.width}%`, height: `${corners.height}%` }}>
          <i /><i /><i /><i />
        </div>
      )}
      {mode === "live" && live && !film.heldByYou && (
        <div className="pointer" style={{ left: "52%", top: "76%" }} aria-hidden="true"><Cursor /><span>Dolly</span></div>
      )}
      {rec && live && !film.paused && !film.heldByYou && (
        <span className="overlay-tag"><span className="rec-dot" aria-hidden="true" />REC</span>
      )}
      {(film.paused || film.heldByYou) && mode === "live" && (
        <span className="overlay-tag">{film.heldByYou ? "You have the controls" : "Paused"}</span>
      )}
      {caption && <span className="caption">{caption}</span>}
    </div>
  );
}

interface StripProps {
  film: Film;
  onRetake?: (shot: Shot) => void;
  onSelect?: (shot: Shot) => void;
  height?: number;
}

export function Filmstrip({ film, onRetake, onSelect, height = 54 }: StripProps) {
  const columns = film.shots.map((shot) => `${shot.seconds}fr`).join(" ");
  return (
    <div>
      <div className="strip" style={{ gridTemplateColumns: columns }}>
        {film.shots.map((shot, index) => {
          const filmed = shot.state === "done" || shot.state === "live" || shot.take > 0;
          const classes = ["seg-frame", filmed ? "filmed" : "", shot.state === "live" ? "live" : "", onRetake && shot.state === "done" ? "can-retake" : ""];
          return (
            <button
              key={shot.id}
              type="button"
              className={classes.join(" ")}
              style={{ height, background: filmed ? shade(film.app.tint, index) : undefined }}
              aria-label={`Shot ${index + 1}, ${shot.title}, ${shot.seconds} seconds, ${STATE_WORD[shot.state]}`}
              onClick={() => (onRetake && shot.state === "done" ? onRetake(shot) : onSelect?.(shot))}
            >
              {onRetake && shot.state === "done" && <span className="retake">Retake</span>}
            </button>
          );
        })}
      </div>
      <div className="strip-names" style={{ gridTemplateColumns: columns }}>
        {film.shots.map((shot) => (
          <span key={shot.id}>
            <span style={{ fontWeight: shot.state === "live" ? 600 : 400, color: shot.state === "todo" ? "var(--mute)" : "var(--ink)" }}>{shot.title}</span>
            <em className="tabular">{clock(shot.seconds)}</em>
          </span>
        ))}
      </div>
    </div>
  );
}

const STATE_WORD = { todo: "not filmed yet", live: "filming now", retake: "to film again", done: "filmed" } as const;

/** Neighbouring shots get slightly different shades of the app's footage colour. */
export function shade(tint: string, index: number): string {
  const amount = [-8, 6, 0, -4, 10, -2][index % 6] ?? 0;
  const hex = tint.replace("#", "");
  if (hex.length !== 6) return tint;
  const channel = (at: number) => Math.max(0, Math.min(255, parseInt(hex.slice(at, at + 2), 16) + amount));
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}

export function clock(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

interface QuestionProps {
  film: Film;
  question: Question;
  now: number;
  onAnswer: (optionId: string) => void;
  compact?: boolean;
}

/** The waiting question: text, its countdown, and the options with Dolly's pick last and filled. */
export function QuestionLine({ film, question, now, onAnswer, compact }: QuestionProps) {
  const left = secondsLeft(question, now);
  const total = question.seconds ?? 60;
  const pick = question.options.find((option) => option.id === question.recommended);
  const others = question.options.filter((option) => option.id !== question.recommended);
  const shot = question.shotId ? shotNumber(film, question.shotId) : 0;
  const footnote = left === null
    ? "Dolly waits for your answer."
    : film.paused || film.heldByYou
      ? `Countdown paused at ${left} s.`
      : `If you don’t answer, Dolly picks “${pick?.label ?? ""}” in ${left} s.`;
  return (
    <>
      {left !== null && !compact && <Countdown left={left} total={Math.max(total, left)} />}
      <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{shot && !question.text.startsWith("Shot") ? `Shot ${shot} · ` : ""}{question.text}</span>
        {!compact && <span className="mute" style={{ fontSize: 12 }}>{footnote}</span>}
      </div>
      {others.map((option) => (
        <button key={option.id} type="button" className={compact ? "btn small" : "btn"} onClick={() => onAnswer(option.id)}>{option.label}</button>
      ))}
      {pick && <button type="button" className={compact ? "btn small primary" : "btn primary"} onClick={() => onAnswer(pick.id)}>{pick.label}</button>}
    </>
  );
}
