// One film. While Dolly works: the live view, the shot under way, the
// filmstrip, and the one question if there is one. Once ready: the player, the
// filmstrip with retakes, and a field to ask for changes. The inspector holds
// the why: the direction, each shot's reason, and what it cost.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { duration, timeline } from "../preview/camera.ts";
import { etaText, liveShot, shotNumber } from "../model/store.ts";
import { FORMATS, STAGE_LABEL, STAGES, type Film as FilmData, type FormatId, type Shot } from "../model/types.ts";
import { reveal } from "../platform.ts";
import { useNow, useSnapshot, useStudio } from "../state.tsx";
import { Back, Inspector as InspectorIcon, PauseGlyph, Play, StepChevron } from "../ui/icons.tsx";
import { clock, Filmstrip, Footage, QuestionLine } from "../ui/film.tsx";
import { Menu, type MenuItem } from "../ui/menu.tsx";
import { filmTitle, money, MOVE_NAME, sentences, shapes } from "../ui/words.ts";

export function Film({ filmId, onBack }: { filmId: string; onBack: () => void }) {
  const { films } = useSnapshot();
  const film = films.find((item) => item.id === filmId);
  const [inspector, setInspector] = useState(false);

  useEffect(() => {
    if (!film) onBack();
  }, [film, onBack]);
  if (!film) return null;

  return film.stage === "ready"
    ? <Ready film={film} inspector={inspector} onInspector={() => setInspector(!inspector)} onBack={onBack} />
    : <Making film={film} inspector={inspector} onInspector={() => setInspector(!inspector)} onBack={onBack} />;
}

interface PageProps {
  film: FilmData;
  inspector: boolean;
  onInspector: () => void;
  onBack: () => void;
}

/** Width available to the footage: the column, at most 864 px. */
function useColumn(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(864);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const box = element.getBoundingClientRect();
      // Leave room under the footage for the shot line, the strip and its names.
      const byHeight = ((box.height - 24 - 150) * 16) / 9;
      setWidth(Math.max(320, Math.floor(Math.min(864, box.width - 48, byHeight))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function Making({ film, inspector, onInspector, onBack }: PageProps) {
  const studio = useStudio();
  const now = useNow(250);
  const [column, width] = useColumn();
  const [message, setMessage] = useState("");
  const live = liveShot(film);
  const asked = film.shots.find((shot) => shot.id === film.question?.shotId);
  const stageIndex = STAGES.indexOf(film.stage);
  const held = film.paused || film.heldByYou;

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "Escape") studio.takeOver(film.id);
      if (event.key === "." && (event.metaKey || event.ctrlKey)) (film.paused ? studio.resume : studio.pause)(film.id);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [film.id, film.paused, studio]);

  return (
    <div className="window ground">
      <header className="toolbar inset" data-tauri-drag-region>
        <button type="button" className="icon-btn" aria-label="Back to Films" onClick={onBack}><Back /></button>
        <div className="stack side" style={{ width: 300 }}>
          <b>{filmTitle(film)}</b>
          <span>{film.app.name} · {film.length} s · {shapes(film)}</span>
        </div>
        <span className="spacer" />
        <ol className="steps" aria-label="Progress">
          {STAGES.slice(0, 4).map((stage, index) => (
            <li key={stage} aria-current={index === stageIndex ? "step" : undefined} className={index < stageIndex ? "done" : index === stageIndex ? "now" : ""}>
              {STAGE_LABEL[stage]}
              {index < 3 && <StepChevron />}
            </li>
          ))}
        </ol>
        <span className="spacer" />
        <div className="side end" style={{ width: 300 }}>
          <button type="button" className={inspector ? "icon-btn on" : "icon-btn"} aria-label={inspector ? "Hide details" : "Show details"} aria-pressed={inspector} onClick={onInspector}><InspectorIcon /></button>
          {film.heldByYou ? (
            <button type="button" className="btn primary" onClick={() => studio.resume(film.id)}>Hand Back to Dolly</button>
          ) : film.paused ? (
            <button type="button" className="btn primary" onClick={() => studio.resume(film.id)}>Resume</button>
          ) : (
            <button type="button" className="btn" disabled={!!film.error} onClick={() => studio.pause(film.id)}>Pause</button>
          )}
          {!film.heldByYou && (
            <button type="button" className="btn" disabled={!!film.error} onClick={() => studio.takeOver(film.id)}>Take Over <span className="hint">esc</span></button>
          )}
        </div>
      </header>

      <div className="body">
        <div className="column" ref={column}>
          <div style={{ width, display: "flex", flexDirection: "column" }}>
            <Footage film={film} width={width} mode="live" rec />
            <div className="shot-line">
              {!live && asked ? (
                <>
                  <span style={{ fontWeight: 600 }}>Shot {shotNumber(film, asked.id)} — {asked.title}</span>
                  <span className="mute ellipsis">{MOVE_NAME[asked.move]} · {clock(asked.seconds)} · waiting for your answer</span>
                </>
              ) : live ? (
                <>
                  <span style={{ fontWeight: 600 }}>Shot {shotNumber(film, live.id)} — {live.title}</span>
                  <span className="mute ellipsis">{MOVE_NAME[live.move]} · {clock(live.seconds)} · {lower(film.doing || live.action)}</span>
                </>
              ) : (
                <>
                  <span style={{ fontWeight: 600 }}>{held ? statusWord(film) : STAGE_LABEL[film.stage]}</span>
                  <span className="mute ellipsis">{film.doing}{film.stage === "explore" && film.screens.length > 0 ? ` · ${film.screens.length} screens so far` : ""}</span>
                </>
              )}
              <span className="spacer" />
              <span className="mute" style={{ whiteSpace: "nowrap" }}>{held ? "" : etaText(film)}</span>
            </div>
            {film.shots.length > 0 ? <Filmstrip film={film} /> : <ScreensFound film={film} />}
          </div>
        </div>
        {inspector && <Details film={film} />}
      </div>

      <footer className="bottom">
        <div className="inner" style={{ width }}>
          {film.error ? (
            <>
              <div style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 3 }}>
                <span style={{ fontWeight: 600 }}>{film.error}</span>
                <span className="mute" style={{ fontSize: 12 }}>Starting again keeps the app, formats and length you chose.</span>
              </div>
              <button type="button" className="btn primary" onClick={() => studio.restart(film.id)}>Start Again</button>
            </>
          ) : film.question ? (
            <QuestionLine film={film} question={film.question} now={now} onAnswer={(option) => studio.answer(film.id, option)} />
          ) : (
            <MessageField
              value={message}
              onChange={setMessage}
              placeholder={film.heldByYou ? "Tell Dolly what you changed, then hand back" : "Tell Dolly something, like “skip the pricing screen”"}
              onSend={() => {
                studio.message(film.id, message);
                setMessage("");
              }}
              hint="Dolly reads it before its next step."
            />
          )}
        </div>
      </footer>
    </div>
  );
}

function statusWord(film: FilmData): string {
  return film.heldByYou ? "You have the controls" : "Paused";
}

const lower = (text: string) => (text ? text[0]!.toLowerCase() + text.slice(1) : text);

/** Before there is a shot list: the screens Dolly has looked at, as text. */
function ScreensFound({ film }: { film: FilmData }) {
  if (film.screens.length === 0) return null;
  return (
    <p className="mute" style={{ margin: 0, fontSize: 12, lineHeight: 1.6 }}>
      Explored: {film.screens.map((screen) => screen.name).join(" · ")}
    </p>
  );
}

function MessageField({ value, onChange, onSend, placeholder, hint }: { value: string; onChange: (value: string) => void; onSend: () => void; placeholder: string; hint: string }) {
  return (
    <label style={{ flex: "1 1 auto", display: "flex", alignItems: "center", gap: 12 }}>
      <span className="sr">{placeholder}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && value.trim()) onSend();
        }}
        style={{ flex: "1 1 auto", minWidth: 0, height: 30, border: 0, background: "transparent", outline: "none" }}
      />
      <span className="mute" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{value.trim() ? "Press Return to send" : hint}</span>
    </label>
  );
}

function Ready({ film, inspector, onInspector, onBack }: PageProps) {
  const studio = useStudio();
  const [column, width] = useColumn();
  const [message, setMessage] = useState("");
  const [format, setFormat] = useState<FormatId>(film.formats[0] ?? "website");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const player = usePlayer(film);
  const made = film.finishedAt ? Math.max(1, Math.round((film.finishedAt - film.createdAt) / 60000)) : null;

  const exports: MenuItem[] = film.outputs.length
    ? [
        ...film.outputs.map((path) => ({ label: `Show ${outputName(film, path)} in Finder`, run: () => reveal(path) })),
      ]
    : [{ label: "No files yet", run: () => {}, disabled: true }];

  return (
    <div className="window ground">
      <header className="toolbar inset" data-tauri-drag-region>
        <button type="button" className="icon-btn" aria-label="Back to Films" onClick={onBack}><Back /></button>
        <div className="stack side" style={{ width: 300 }}>
          <b>{filmTitle(film)}</b>
          <span>{film.app.name} · {film.length} s{made ? ` · made in ${made} min` : ""}</span>
        </div>
        <span className="spacer" />
        {film.formats.length > 1 && (
          <div className="seg" role="radiogroup" aria-label="Format">
            {film.formats.map((id) => (
              <button key={id} type="button" role="radio" aria-checked={format === id} onClick={() => setFormat(id)}>
                {FORMATS.find((item) => item.id === id)?.shape}
              </button>
            ))}
          </div>
        )}
        <span className="spacer" />
        <div className="side end" style={{ width: 300 }}>
          {film.version > 1 && <span className="mute" style={{ fontSize: 12 }}>Version {film.version}</span>}
          <button type="button" className={inspector ? "icon-btn on" : "icon-btn"} aria-label={inspector ? "Hide details" : "Show details"} aria-pressed={inspector} onClick={onInspector}><InspectorIcon /></button>
          <button
            type="button"
            className="btn"
            aria-haspopup="menu"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setMenu({ x: box.right, y: box.bottom + 4 });
            }}
          >
            Export…
          </button>
        </div>
      </header>

      <div className="body">
        <div className="column" ref={column}>
          <div style={{ width, display: "flex", flexDirection: "column" }}>
            <PlayerFrame film={film} width={width} format={format} t={player.t} />
            <div className="shot-line" style={{ alignItems: "center", gap: 14 }}>
              <button type="button" className="icon-btn" aria-label={player.playing ? "Pause" : "Play"} onClick={player.toggle}>
                {player.playing ? <PauseGlyph /> : <Play />}
              </button>
              <span className="tabular" style={{ fontSize: 12 }}>{clock(player.t)}</span>
              <Scrubber t={player.t} total={player.total} onSeek={player.seek} />
              <span className="tabular mute" style={{ fontSize: 12 }}>{clock(player.total)}</span>
            </div>
            <Filmstrip film={film} onRetake={(shot) => studio.retake(film.id, shot.id)} onSelect={(shot) => player.seek(shotStart(film, shot))} />
          </div>
        </div>
        {inspector && <Details film={film} />}
      </div>

      <footer className="bottom">
        <div className="inner" style={{ width }}>
          <MessageField
            value={message}
            onChange={setMessage}
            placeholder="Ask for a change, like “end on the logo a bit longer”"
            onSend={() => {
              studio.message(film.id, message);
              setMessage("");
            }}
            hint="Only the changed shots are filmed again."
          />
        </div>
      </footer>
      {menu && <Menu x={menu.x} y={menu.y} align="right" items={exports} onClose={() => setMenu(null)} />}
    </div>
  );
}

function outputName(film: FilmData, path: string): string {
  const format = FORMATS.find((item) => path.includes(`(${item.id}`) || path.toLowerCase().includes(item.shape.toLowerCase()));
  return format?.shape ?? path.split("/").pop() ?? path;
}

function shotStart(film: FilmData, shot: Shot): number {
  return timeline(film).find((placed) => placed.shot.id === shot.id)?.start ?? 0;
}

/** The finished film in the chosen format, letterboxed into the 16:9 player. */
function PlayerFrame({ film, width, format, t }: { film: FilmData; width: number; format: FormatId; t: number }) {
  const height = Math.round((width * 9) / 16);
  const [w, h] = FORMATS.find((item) => item.id === format)?.size ?? [16, 9];
  const inner = w / h >= 16 / 9 ? width : Math.round((height * w) / h);
  const lines = sentences(film.line);
  const placed = timeline(film);
  const index = placed.findIndex((item) => t >= item.start && t < item.end);
  const caption = index === 0 ? lines[0] : index === placed.length - 1 || index === -1 ? lines.at(-1) : undefined;
  return (
    <div style={{ width, height, display: "flex", justifyContent: "center", background: inner < width ? "#1d1d1f" : undefined }}>
      <Footage film={film} width={inner} height={height} aspect={FORMATS.find((item) => item.id === format)?.aspect ?? "16:9"} mode="player" t={t} {...(caption ? { caption } : {})} />
    </div>
  );
}

function usePlayer(film: FilmData) {
  const total = Math.max(duration(film), 0.001);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    last.current = null;
    const tick = (now: number) => {
      const delta = last.current === null ? 0 : (now - last.current) / 1000;
      last.current = now;
      let stop = false;
      setT((current) => {
        const next = current + delta;
        if (next >= total) {
          stop = true;
          return total;
        }
        return next;
      });
      if (stop) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, total]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key !== " " || event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  const toggle = () => {
    if (!playing && t >= total) setT(0);
    setPlaying(!playing);
  };
  return { t: Math.min(t, total), total, playing, toggle, seek: (to: number) => setT(Math.max(0, Math.min(total, to))) };
}

function Scrubber({ t, total, onSeek }: { t: number; total: number; onSeek: (t: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const share = total > 0 ? t / total : 0;
  const seekTo = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (box) onSeek(((clientX - box.left) / box.width) * total);
  };
  return (
    <div
      ref={ref}
      className="scrubber"
      role="slider"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(t)}
      aria-valuetext={`${clock(t)} of ${clock(total)}`}
      tabIndex={0}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        seekTo(event.clientX);
      }}
      onPointerMove={(event) => {
        if (event.buttons) seekTo(event.clientX);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") onSeek(t + 1);
        if (event.key === "ArrowLeft") onSeek(t - 1);
      }}
    >
      <span className="played" style={{ width: `${share * 100}%` }} />
      <span className="knob" style={{ left: `${share * 100}%` }} />
    </div>
  );
}

function Details({ film }: { film: FilmData }) {
  const studio = useStudio();
  const [screens, setScreens] = useState(false);
  const picked = film.screens.filter((screen) => screen.picked).length;
  return (
    <aside className="inspector" aria-label="Film details">
      <section style={{ paddingTop: 20 }}>
        <span className="caps">Direction</span>
        {film.line ? (
          <>
            <span className="h2">{film.line}</span>
            {film.why && <span style={{ fontSize: 12, lineHeight: 1.55, color: "var(--ink-2)" }}>{film.why}</span>}
            {film.alternatives.length > 0 && (
              <>
                <span className="mute" style={{ fontSize: 12, paddingTop: 4 }}>Also considered</span>
                {film.alternatives.map((line) => (
                  <div key={line} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                    <span style={{ flex: "1 1 auto" }}>{line}</span>
                    <button type="button" className="btn tiny" onClick={() => studio.changeDirection(film.id, line)} aria-label={`Use “${line}”`}>Use</button>
                  </div>
                ))}
              </>
            )}
          </>
        ) : (
          <span className="mute" style={{ fontSize: 12 }}>Dolly settles on one line once it has seen the app.</span>
        )}
      </section>

      {film.shots.length > 0 && (
        <section>
          <div style={{ display: "flex", alignItems: "baseline" }}>
            <span className="caps" style={{ flex: "1 1 auto" }}>Shots</span>
            <span className="mute" style={{ fontSize: 11 }}>Why each one</span>
          </div>
          {film.shots.map((shot, index) => (
            <div key={shot.id} className="why">
              <span className="mute">{index + 1}</span>
              <span style={{ fontWeight: 500 }}>{shot.title} <span className="mute" style={{ fontWeight: 400 }}>· {MOVE_NAME[shot.move]}</span></span>
              <span />
              <span style={{ color: "var(--ink-2)", lineHeight: 1.45 }}>{shot.why}</span>
            </div>
          ))}
        </section>
      )}

      <section style={{ gap: 0, paddingTop: 14, paddingBottom: 14 }}>
        <button type="button" className="row" aria-expanded={screens} onClick={() => setScreens(!screens)} disabled={film.screens.length === 0}>
          <span style={{ flex: "1 1 auto" }}>Screens Dolly explored</span>
          <span className="mute" style={{ marginRight: 8 }}>{film.screens.length}</span>
          <span style={{ transform: screens ? "rotate(90deg)" : undefined, display: "flex" }}><StepChevron /></span>
        </button>
        {screens && (
          <ul className="screens">
            {film.screens.map((screen) => (
              <li key={screen.name}>{screen.name}{screen.picked && <span className="mute"> · in the film</span>}</li>
            ))}
            {picked > 0 && <li className="mute">{picked} of {film.screens.length} made it into the film.</li>}
          </ul>
        )}
        <Row name="Everything Dolly did">{film.steps} steps</Row>
        <Row name={film.stage === "ready" ? "Cost" : "Cost so far"}>{money(film.cost)}</Row>
      </section>
    </aside>
  );
}

function Row({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="row">
      <span style={{ flex: "1 1 auto" }}>{name}</span>
      <span className="mute">{children}</span>
    </div>
  );
}
