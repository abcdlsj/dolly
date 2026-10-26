// Each window loads this page; the hash says which one it is. The main window
// owns the state and the agent; the others mirror it over the bridge.

import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { RemoteStudio, serve, type Destination } from "./bridge.ts";
import { realClock, type Director } from "./agent/director.ts";
import { PiDirector } from "./agent/pi.ts";
import { SimulatedDirector } from "./agent/simulated.ts";
import { liveShot, shotNumber, Store, type Snapshot } from "./model/store.ts";
import { channel, dolly, hidePanel, isNative, keyHint, notify, openPanel, quit, route, setTrayTitle, simulates, spawnPi } from "./platform.ts";
import { Film } from "./screens/Film.tsx";
import { Library } from "./screens/Library.tsx";
import { NewFilm } from "./screens/NewFilm.tsx";
import { Onboarding } from "./screens/Onboarding.tsx";
import { activeFilm, Glance, Tray } from "./screens/Panels.tsx";
import { Settings } from "./screens/Settings.tsx";
import { StudioProvider, useSnapshot } from "./state.tsx";
import "./styles.css";

const SAVED = "dolly-studio";
const panel = route();
document.documentElement.dataset.panel = panel;

function load(store: Store): void {
  try {
    const saved = localStorage.getItem(SAVED);
    if (saved) store.load(JSON.parse(saved) as Snapshot);
  } catch {
    // A missing or unreadable save starts empty.
  }
}

// The key lives in the keychain, which outlives the web view: a window that
// starts with empty storage must not go on rehearsing while a key is right
// there. Switching provider re-asks, since each one has its own entry.
function adoptKeyHint(store: Store): void {
  let asked = "";
  const adopt = async () => {
    const { provider, keyHint: hint } = store.settings;
    if (hint || provider === asked) return;
    asked = provider;
    const found = await keyHint(provider).catch(() => "");
    if (found) store.updateSettings({ keyHint: found });
  };
  store.subscribe(() => void adopt());
  void adopt();
}

function save(store: Store): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return store.subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(SAVED, JSON.stringify(store.snapshot()));
      } catch {
        // Storage can be full or blocked; the films still run.
      }
    }, 300);
  });
}

/** A film is rehearsed until the app has a key; with one, pi does the real work. */
function direct(store: Store): void {
  const wantsPi = () => !simulates(store.settings);
  let usingPi = wantsPi();
  const make = (): Director => (usingPi ? new PiDirector(spawnPi, realClock, () => dolly.run(["release"]).then(() => {})) : new SimulatedDirector());
  let stop = make().attach(store);
  store.subscribe(() => {
    if (wantsPi() === usingPi) return;
    stop();
    usingPi = wantsPi();
    stop = make().attach(store);
  });
}

/** Tells the person when Dolly needs them or a film is done, while Studio is out of sight. */
function announce(store: Store): () => void {
  const asked = new Set<string>();
  const done = new Set(store.snapshot().films.filter((film) => film.stage === "ready").map((film) => film.id));
  return store.subscribe(() => {
    const { films, settings } = store.snapshot();
    const away = document.hidden || !document.hasFocus();
    for (const film of films) {
      const question = film.question;
      if (question && !asked.has(question.id)) {
        asked.add(question.id);
        const pick = question.options.find((option) => option.id === question.recommended)?.label;
        if (away && settings.notifyAsk) {
          void notify(`${film.app.name} film needs an answer`, question.seconds && pick ? `${question.text} Otherwise Dolly picks “${pick}” in ${question.seconds} s.` : question.text);
        }
      }
      if (film.stage === "ready" && !done.has(film.id)) {
        done.add(film.id);
        if (away && settings.notifyReady) void notify("Your film is ready", `${film.app.name} · ${film.line}`);
      }
    }
    const film = activeFilm(films);
    const live = film && liveShot(film);
    setTrayTitle(film && live ? `${shotNumber(film, live.id)}/${film.shots.length}` : "");
  });
}

type View = { page: "library" } | { page: "film"; id: string };

function App({ inbox }: { inbox: (listener: (to: Destination) => void) => () => void }) {
  const { settings, films } = useSnapshot();
  const [view, setView] = useState<View>({ page: "library" });
  const [sheet, setSheet] = useState(false);
  const filmsRef = useRef(films);
  filmsRef.current = films;

  const back = useCallback(() => setView({ page: "library" }), []);

  useEffect(
    () =>
      inbox((to) => {
        if ("film" in to) setView({ page: "film", id: to.film });
        if ("library" in to) setView({ page: "library" });
        if ("newFilm" in to) setSheet(true);
        openPanel("main");
      }),
    [inbox],
  );

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === "n" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setSheet(true);
      }
      if (event.key === "," && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        openPanel("settings");
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, []);

  // While another app is in front, the floating panel keeps the film in reach.
  useEffect(() => {
    if (!isNative) return;
    const blur = () => {
      if (activeFilm(filmsRef.current)) openPanel("glance");
    };
    const focus = () => hidePanel("glance");
    window.addEventListener("blur", blur);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
    };
  }, []);

  if (!settings.onboarded) return <Onboarding />;
  return (
    <>
      {view.page === "film" ? (
        <Film filmId={view.id} onBack={back} />
      ) : (
        <Library onOpen={(film) => setView({ page: "film", id: film.id })} onNew={() => setSheet(true)} />
      )}
      {sheet && (
        <NewFilm
          onClose={() => setSheet(false)}
          onMade={(id) => {
            setSheet(false);
            setView({ page: "film", id });
          }}
        />
      )}
    </>
  );
}

function start(): void {
  const root = createRoot(document.getElementById("root")!);
  const bridge = channel();

  if (panel === "main") {
    const store = new Store();
    load(store);
    void adoptKeyHint(store);
    save(store);
    announce(store);
    direct(store);
    serve(store, bridge);
    const inbox = (listener: (to: Destination) => void) => bridge.listen((message) => message.kind === "open" && listener(message.to));
    root.render(<StrictMode><StudioProvider studio={store}><App inbox={inbox} /></StudioProvider></StrictMode>);
    return;
  }

  const remote = new RemoteStudio(bridge);
  const open = (to: Destination) => remote.open(to);
  const page = panel === "settings" ? <Settings /> : panel === "glance" ? <Glance open={open} /> : <Tray open={open} quit={quit} />;
  root.render(<StrictMode><StudioProvider studio={remote}>{page}</StudioProvider></StrictMode>);
}

start();
