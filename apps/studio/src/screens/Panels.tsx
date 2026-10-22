// The two small windows that keep Dolly in reach while another app is in
// front: the floating panel in the corner while a film is being made, and the
// panel under the menu bar icon.

import { useState } from "react";
import type { Destination } from "../bridge.ts";
import { etaText, liveShot, needsYou, secondsLeft, shotNumber, statusLine } from "../model/store.ts";
import type { Film } from "../model/types.ts";
import { closePanel, openPanel } from "../platform.ts";
import { useNow, useSnapshot, useStudio } from "../state.tsx";
import { Expand, Gear, More, PauseGlyph } from "../ui/icons.tsx";
import { Footage } from "../ui/film.tsx";
import { Menu } from "../ui/menu.tsx";
import { filmTitle } from "../ui/words.ts";

/** The film to show: one that needs an answer first, then the newest being made. */
export function activeFilm(films: readonly Film[]): Film | undefined {
  const making = films.filter((film) => film.stage !== "ready");
  return making.find((film) => film.question) ?? making.find((film) => !film.error) ?? making[0];
}

function progressLine(film: Film): string {
  const live = liveShot(film);
  const where = live ? `shot ${shotNumber(film, live.id)} of ${film.shots.length}` : statusLine(film).toLowerCase();
  const eta = etaText(film).toLowerCase();
  return [film.app.name, where, eta].filter(Boolean).join(" · ");
}

function Thumb({ film, width = 56, height = 35 }: { film: Film; width?: number; height?: number }) {
  return (
    <span className="thumb" style={{ width, height, background: film.app.tint }} aria-hidden="true"><i /></span>
  );
}

/** The question, short: text and seconds left on one line, the two answers under it. */
function Ask({ film, now, align = "end" }: { film: Film; now: number; align?: "start" | "end" }) {
  const studio = useStudio();
  const question = film.question;
  if (!question) return null;
  const left = secondsLeft(question, now);
  const pick = question.options.find((option) => option.id === question.recommended);
  const others = question.options.filter((option) => option !== pick);
  return (
    <div className="ask">
      <span style={{ lineHeight: 1.4 }}>{question.text} {left !== null && <span className="mute tabular">{left} s</span>}</span>
      <div style={{ display: "flex", gap: 6, justifyContent: align === "end" ? "flex-end" : "flex-start", flexDirection: align === "end" ? "row" : "row-reverse" }}>
        {others.map((option) => (
          <button key={option.id} type="button" className={align === "end" ? "btn small" : "btn small outline"} onClick={() => studio.answer(film.id, option.id)}>{option.label}</button>
        ))}
        {pick && <button type="button" className="btn small primary" onClick={() => studio.answer(film.id, pick.id)}>{pick.label}</button>}
      </div>
    </div>
  );
}

export function Glance({ open }: { open: (to: Destination) => void }) {
  const { films } = useSnapshot();
  const studio = useStudio();
  const now = useNow(250);
  const film = activeFilm(films);
  if (!film) return <div className="panel glance empty-panel"><span className="mute">Nothing is being filmed.</span></div>;
  const live = liveShot(film);
  const recording = !!live && !film.paused && !film.heldByYou;
  return (
    <div className="panel glance" role="dialog" aria-label="Dolly">
      <div className="glance-head" data-tauri-drag-region>
        <Thumb film={film} />
        <span style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
            {recording && <span className="rec-dot" aria-hidden="true" />}
            {live && !film.paused && !film.heldByYou ? `Shot ${shotNumber(film, live.id)} of ${film.shots.length}` : statusLine(film)}
          </span>
          <span className="mute ellipsis" style={{ fontSize: 12 }}>{[film.app.name, etaText(film).toLowerCase()].filter(Boolean).join(" · ")}</span>
        </span>
        <button type="button" className="icon-btn small" aria-label="Open Dolly" onClick={() => open({ film: film.id })}><Expand /></button>
      </div>
      {film.question && <div className="glance-part"><Ask film={film} now={now} /></div>}
      <div className="glance-actions">
        {film.paused || film.heldByYou ? (
          <button type="button" style={{ fontWeight: 500 }} onClick={() => studio.resume(film.id)}>{film.heldByYou ? "Hand Back" : "Resume"}</button>
        ) : (
          <>
            <button type="button" onClick={() => studio.pause(film.id)}>Pause <span className="mute">⌘.</span></button>
            <span className="divider" />
            <button type="button" style={{ fontWeight: 500 }} onClick={() => studio.takeOver(film.id)}>Take Over <span className="mute" style={{ fontWeight: 400 }}>esc</span></button>
          </>
        )}
      </div>
    </div>
  );
}

export function Tray({ open, quit }: { open: (to: Destination) => void; quit: () => void }) {
  const { films } = useSnapshot();
  const studio = useStudio();
  const now = useNow(250);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const film = activeFilm(films);
  const others = films.filter((item) => item !== film).slice(0, 4);
  const go = (to: Destination) => {
    open(to);
    closePanel();
  };
  const making = films.filter((item) => item.stage !== "ready" && !item.error);

  return (
    <div className="panel tray" role="dialog" aria-label="Dolly">
      {film && (
        <>
          <button type="button" className="tray-hero" aria-label={`Open the ${film.app.name} film`} onClick={() => go({ film: film.id })}>
            <Footage film={film} width={320} height={180} mode="still" rec />
          </button>
          {film.shots.length > 0 && (
            <div className="tray-progress" style={{ gridTemplateColumns: film.shots.map((shot) => `${shot.seconds}fr`).join(" ") }} aria-hidden="true">
              {film.shots.map((shot) => <span key={shot.id} className={shot.state === "done" ? "done" : shot.state === "live" ? "live" : ""} />)}
            </div>
          )}
          <div style={{ padding: "14px 16px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ fontWeight: 600 }}>{filmTitle(film)}</span>
            <span className="mute" style={{ fontSize: 12 }}>{film.error ?? progressLine(film)}</span>
          </div>
          {film.question && <div className="tray-ask"><Ask film={film} now={now} align="start" /></div>}
        </>
      )}
      {others.length > 0 && (
        <div className="tray-list">
          {others.map((item) => (
            <button key={item.id} type="button" onClick={() => go({ film: item.id })}>
              <Thumb film={item} width={40} height={25} />
              <span style={{ flex: "1 1 auto", textAlign: "left" }}>{item.app.name}</span>
              <span className="mute" style={{ fontSize: 12 }}>
                {needsYou(item) && <span className="wait-dot" aria-hidden="true" style={{ marginRight: 6 }} />}
                {item.stage === "ready" ? "Ready" : statusLine(item)}
              </span>
            </button>
          ))}
        </div>
      )}
      {!film && others.length === 0 && <div className="mute" style={{ padding: "18px 16px" }}>No films yet.</div>}
      <div className="tray-foot">
        <button type="button" className="new" onClick={() => go({ newFilm: true })}>New Film… <span className="hint">⌘N</span></button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Pause all films"
          disabled={making.length === 0}
          onClick={() => making.forEach((item) => studio.pause(item.id))}
        >
          <PauseGlyph />
        </button>
        <button type="button" className="icon-btn" aria-label="Settings" onClick={() => { openPanel("settings"); closePanel(); }}><Gear /></button>
        <button
          type="button"
          className="icon-btn"
          aria-label="More"
          aria-haspopup="menu"
          onClick={(event) => {
            const box = event.currentTarget.getBoundingClientRect();
            setMenu({ x: box.right, y: box.top - 72 }); // opens upward, inside the panel
          }}
        >
          <More />
        </button>
      </div>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          align="right"
          onClose={() => setMenu(null)}
          items={[
            { label: "Open Dolly", run: () => go({ library: true }) },
            "separator",
            { label: "Quit Dolly", run: quit },
          ]}
        />
      )}
    </div>
  );
}
