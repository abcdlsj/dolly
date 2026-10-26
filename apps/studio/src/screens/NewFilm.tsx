// The New Film sheet: the app on the left, four choices on the right, and one
// button. Everything has a default, so ⌘↩ alone makes a film.

import { useEffect, useRef, useState } from "react";
import { ASK_LEVELS, FORMATS, LENGTHS, type AppRef, type AskLevel, type FormatId, type Length } from "../model/types.ts";
import { chooseApp, installedApps, isNative, type InstalledApp } from "../platform.ts";
import { useSnapshot, useStudio } from "../state.tsx";
import { Menu, type MenuItem } from "../ui/menu.tsx";

// Footage backgrounds: quiet, slightly cool grays that let any app's colours sit on top.
const TINTS = ["#AEB7C2", "#B7C2BA", "#C9BFB4", "#B4B6C8", "#BFC3B0", "#C8B8BE"];

export function tintFor(name: string): string {
  if (name === "Margin") return TINTS[0]!;
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length]!;
}

const toRef = (app: InstalledApp): AppRef => ({ ...app, tint: tintFor(app.name) });

export function NewFilm({ onClose, onMade }: { onClose: () => void; onMade: (filmId: string) => void }) {
  const studio = useStudio();
  const { settings, films } = useSnapshot();
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [app, setApp] = useState<AppRef | null>(films[0]?.app ?? null);
  const [formats, setFormats] = useState<FormatId[]>(["website", "social"]);
  const [length, setLength] = useState<Length>(30);
  const [ask, setAsk] = useState<AskLevel>(settings.ask);
  const [privateCopy, setPrivateCopy] = useState(settings.privateCopy);
  const [notes, setNotes] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void installedApps().then((list) => {
      setApps(list);
      setApp((current) => current ?? (list[0] ? toRef(list[0]) : null));
    });
  }, []);

  const make = () => {
    if (!app || formats.length === 0) return;
    onMade(studio.create({ app, formats, length, ask, notes, privateCopy }));
  };

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !menu) onClose();
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) make();
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  useEffect(() => {
    sheet.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, []);

  const toggle = (id: FormatId) => setFormats((current) => (current.includes(id) ? current.filter((format) => format !== id) : FORMATS.map((format) => format.id).filter((format) => format === id || current.includes(format))));

  const appItems: MenuItem[] = [
    ...apps.map((item) => ({ label: item.name, run: () => setApp(toRef(item)) })),
    ...(isNative ? ["separator" as const, { label: "Other…", run: () => void chooseApp().then((picked) => picked && setApp(toRef(picked))) }] : []),
  ];

  const minutes = { 15: 12, 30: 20, 60: 35 }[length];
  const level = ASK_LEVELS.find((item) => item.id === ask);

  return (
    <div className="scrim" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-label="New film">
        <div className="sheet-side">
          <div className="app-frame" style={{ background: app?.tint ?? "#e9e9ec" }} role="img" aria-label={app ? `${app.name}, ready to film` : "No app chosen"}>
            {app && (
              <span className="win">
                <span className="win-bar" />
                <span className="win-side" />
                <span className="win-title" style={{ left: "32%", width: "44%" }} />
                <span className="win-line" style={{ left: "32%", top: "44%", width: "58%" }} />
                <span className="win-line" style={{ left: "32%", top: "55%", width: "48%" }} />
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span className="h2">{app?.name ?? "No app yet"}</span>
            <span className="mute" style={{ fontSize: 12 }}>{app?.version ? `Version ${app.version}` : app ? app.path : "Choose the app to film."}</span>
          </div>
          <button
            type="button"
            className="link"
            style={{ alignSelf: "flex-start" }}
            aria-haspopup="menu"
            onClick={(event) => {
              const box = event.currentTarget.getBoundingClientRect();
              setMenu({ x: box.left, y: box.bottom + 4 });
            }}
          >
            {app ? "Choose another app…" : "Choose an app…"}
          </button>
          <span className="spacer" />
          <span className="mute" style={{ fontSize: 12, lineHeight: 1.5 }}>
            {privateCopy
              ? `Dolly works in a private copy of the app. Your own ${app?.name === "Margin" ? "notes" : "files"} and accounts are never opened.`
              : `Dolly works in your own ${app?.name ?? "app"}: your accounts and files are there, so it can get past a login, but it touches real data.`}
          </span>
        </div>

        <div className="sheet-main">
          <span className="h2">New Film</span>

          <div className="field">
            <span className="caps">Formats</span>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 28 }}>
              {FORMATS.map((format) => {
                const on = formats.includes(format.id);
                const [w, h] = format.size;
                return (
                  <button key={format.id} type="button" className="format" aria-pressed={on} onClick={() => toggle(format.id)}>
                    <span className="shape" style={{ width: Math.round((45 * w) / h), height: 45, background: on ? app?.tint ?? "#AEB7C2" : undefined }} />
                    <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <span className="name">{format.name}</span>
                      <span className="mute" style={{ fontSize: 11 }}>{format.ratio}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="field">
            <span className="caps" id="length-label">Length</span>
            <LengthPicker value={length} onChange={setLength} />
          </div>

          <div className="field" style={{ gap: 12 }}>
            <span className="caps" id="ask-label">Dolly asks you</span>
            <div className="texttabs" role="radiogroup" aria-labelledby="ask-label" style={{ gap: 22 }}>
              {ASK_LEVELS.map((item) => (
                <button key={item.id} type="button" role="radio" aria-checked={ask === item.id} onClick={() => setAsk(item.id)}>{item.name}</button>
              ))}
            </div>
            <span className="mute" style={{ fontSize: 12, lineHeight: 1.45 }}>{level?.detail}</span>
          </div>

          <div className="field" style={{ gap: 12 }}>
            <span className="caps" id="copy-label">The app's data</span>
            <div className="texttabs" role="radiogroup" aria-labelledby="copy-label" style={{ gap: 22 }}>
              <button type="button" role="radio" aria-checked={privateCopy} onClick={() => setPrivateCopy(true)}>Private copy</button>
              <button type="button" role="radio" aria-checked={!privateCopy} onClick={() => setPrivateCopy(false)}>My own</button>
            </div>
            <span className="mute" style={{ fontSize: 12, lineHeight: 1.45 }}>
              {privateCopy
                ? "Starts empty, so nothing of yours is touched. An app that needs a login may not get in; Dolly will ask."
                : "Your real copy, with your accounts and files. Use it for an app that cannot run signed out."}
            </span>
          </div>

          <label className="field" style={{ gap: 10 }}>
            <span className="caps">Notes for Dolly</span>
            <textarea
              rows={2}
              className="underline"
              placeholder="Optional. Lead with offline sync, skip the pricing screen…"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>

          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 2 }}>
            <span className="spacer mute" style={{ fontSize: 12 }}>About {minutes} minutes · usually under ${length === 60 ? 2 : 1}</span>
            <button type="button" className="btn plain" onClick={onClose}>Cancel</button>
            <button type="button" className="btn primary" data-autofocus disabled={!app || formats.length === 0} onClick={make}>
              Make Film <span className="hint">⌘↩</span>
            </button>
          </div>
        </div>
      </div>
      {menu && <Menu x={menu.x} y={menu.y} items={appItems.length ? appItems : [{ label: "No apps found", run: () => {}, disabled: true }]} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** A ruler from 0 to 60 seconds with three stops. */
function LengthPicker({ value, onChange }: { value: Length; onChange: (length: Length) => void }) {
  const px = (seconds: number) => seconds * 7;
  const ticks = Array.from({ length: 13 }, (_, index) => index * 5);
  const step = (direction: 1 | -1) => {
    const next = LENGTHS[LENGTHS.indexOf(value) + direction];
    if (next) onChange(next);
  };
  return (
    <div
      className="ruler"
      role="radiogroup"
      aria-labelledby="length-label"
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") step(1);
        if (event.key === "ArrowLeft") step(-1);
      }}
    >
      <span className="track" />
      <span className="fill" style={{ width: px(value) }} />
      {ticks.map((seconds) => {
        const major = seconds === 0 || (LENGTHS as readonly number[]).includes(seconds);
        return <span key={seconds} className={major ? "tick major" : "tick"} style={{ left: px(seconds) }} />;
      })}
      {LENGTHS.map((seconds) => (
        <button
          key={seconds}
          type="button"
          role="radio"
          aria-checked={value === seconds}
          tabIndex={value === seconds ? 0 : -1}
          className="stop"
          style={{ left: px(seconds) - 20 }}
          onClick={() => onChange(seconds)}
        >
          <span className="dot" />
          <span className="label">{seconds} s</span>
        </button>
      ))}
    </div>
  );
}
