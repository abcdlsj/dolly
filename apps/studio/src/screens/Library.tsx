// Films: every film as its first frame, one line and where it stands. No
// cards; the frame and two lines of type are the tile.

import { useMemo, useState } from "react";
import { liveShot, needsYou, progress, statusLine } from "../model/store.ts";
import type { Film } from "../model/types.ts";
import { useSnapshot, useStudio } from "../state.tsx";
import { openPanel } from "../platform.ts";
import { Gear, Plus, Search } from "../ui/icons.tsx";
import { Menu, type MenuItem } from "../ui/menu.tsx";
import { clock } from "../ui/film.tsx";
import { filmTitle } from "../ui/words.ts";

type Filter = "all" | "making" | "ready";
const FILTERS: { id: Filter; name: string }[] = [
  { id: "all", name: "All" },
  { id: "making", name: "In Progress" },
  { id: "ready", name: "Ready" },
];

export function Library({ onOpen, onNew }: { onOpen: (film: Film) => void; onNew: () => void }) {
  const { films } = useSnapshot();
  const studio = useStudio();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ film: Film; x: number; y: number } | null>(null);

  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return films.filter((film) => {
      if (filter === "making" && film.stage === "ready") return false;
      if (filter === "ready" && film.stage !== "ready") return false;
      return !words || `${film.app.name} ${film.line}`.toLowerCase().includes(words);
    });
  }, [films, filter, query]);

  const items = (film: Film): MenuItem[] => [
    { label: "Open", run: () => onOpen(film) },
    ...(film.error ? [{ label: "Start Again", run: () => studio.restart(film.id) }] : []),
    "separator",
    { label: "Delete Film", run: () => studio.remove(film.id) },
  ];

  return (
    <div className="window">
      <header className="toolbar inset" data-drag-region>
        <span className="title" style={{ width: 120 }}>Films</span>
        <span className="spacer" />
        {films.length > 0 && (
          <div className="seg" role="tablist" aria-label="Filter">
            {FILTERS.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} onClick={() => setFilter(item.id)}>{item.name}</button>
            ))}
          </div>
        )}
        <span className="spacer" />
        {films.length > 0 && (
          <label className="search">
            <Search />
            <span className="sr">Search films</span>
            <input placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        )}
        <button type="button" className="btn primary" onClick={onNew}><Plus />New Film</button>
        <button type="button" className="icon-btn" aria-label="Settings" onClick={() => openPanel("settings")}><Gear /></button>
      </header>

      {films.length === 0 ? (
        <div className="empty">
          <b>No films yet</b>
          <span>Give Dolly an app and get back a promo film.</span>
          <button type="button" className="btn primary" onClick={onNew} style={{ marginTop: 8 }}>Choose an App…</button>
        </div>
      ) : shown.length === 0 ? (
        <div className="empty"><span>No films match.</span></div>
      ) : (
        <div className="grid">
          {shown.map((film) => (
            <Tile
              key={film.id}
              film={film}
              onOpen={() => onOpen(film)}
              onMenu={(x, y) => setMenu({ film, x, y })}
            />
          ))}
        </div>
      )}
      {menu && <Menu x={menu.x} y={menu.y} items={items(menu.film)} onClose={() => setMenu(null)} />}
    </div>
  );
}

function Tile({ film, onOpen, onMenu }: { film: Film; onOpen: () => void; onMenu: (x: number, y: number) => void }) {
  const ready = film.stage === "ready";
  const portrait = film.formats.length === 1 && film.formats[0] === "social";
  const live = !ready && !film.paused && !film.heldByYou && !needsYou(film) && (film.stage !== "filming" || !!liveShot(film));
  const meta = ready ? shortDate(film.finishedAt ?? film.createdAt) : statusLine(film);
  return (
    <button
      type="button"
      className="tile"
      onClick={onOpen}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu(event.clientX, event.clientY);
      }}
    >
      <span className="frame" style={{ background: film.app.tint }}>
        <span className={portrait ? "win portrait" : "win"}>
          <span className="win-bar" />
          <span className="win-title" />
          <span className="win-line" style={{ top: "44%", width: "74%" }} />
          <span className="win-line" style={{ top: "55%", width: "62%" }} />
        </span>
        {ready && <span className="len tabular">{clock(film.length)}</span>}
        {!ready && <span className="bar"><i style={{ width: `${Math.round(progress(film) * 100)}%` }} /></span>}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <b>{filmTitle(film)}</b>
        <span className="meta">
          {needsYou(film) ? <span className="wait-dot" aria-hidden="true" /> : live ? <span className="rec-dot" aria-hidden="true" /> : null}
          {film.app.name} · {meta}
        </span>
      </span>
    </button>
  );
}

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
