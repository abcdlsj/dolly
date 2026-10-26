// Settings, in its own window: a text list of sections on the left, rows
// separated by hairlines on the right. Each value sits at the row's end.

import { useEffect, useState, type ReactNode } from "react";
import { ASK_LEVELS, type Settings as SettingsData } from "../model/types.ts";
import { saveKey, testConnection } from "../platform.ts";
import { useSnapshot, useStudio } from "../state.tsx";
import { money } from "../ui/words.ts";

type Section = "General" | "AI" | "Safety" | "About";
const SECTIONS: Section[] = ["General", "AI", "Safety", "About"];

const PROVIDERS: { id: SettingsData["provider"]; name: string; models: string[] }[] = [
  { id: "anthropic", name: "Anthropic", models: ["Recommended", "claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
  { id: "openai", name: "OpenAI", models: ["Recommended", "gpt-5", "gpt-5-mini"] },
  { id: "openrouter", name: "OpenRouter", models: ["Recommended"] },
  { id: "custom", name: "Other (OpenAI-compatible)", models: ["Recommended"] },
];

export function Settings({ initial = "AI" }: { initial?: Section }) {
  const [section, setSection] = useState<Section>(initial);
  return (
    <div className="settings">
      <div className="drag" data-drag-region />
      <nav aria-label="Settings sections">
        {SECTIONS.map((name) => (
          <button key={name} type="button" aria-current={section === name ? "page" : undefined} onClick={() => setSection(name)}>{name}</button>
        ))}
      </nav>
      <main>
        <h1>{section}</h1>
        {section === "General" && <General />}
        {section === "AI" && <AI />}
        {section === "Safety" && <Safety />}
        {section === "About" && <About />}
      </main>
    </div>
  );
}

function Group({ title, children, note }: { title: string; children: ReactNode; note?: string }) {
  return (
    <section className="group">
      <span className="caps">{title}</span>
      {children}
      {note && <span className="note">{note}</span>}
    </section>
  );
}

function Row({ name, detail, children }: { name: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="setting">
      <span className="label"><span>{name}</span>{detail && <span className="mute" style={{ fontSize: 12 }}>{detail}</span>}</span>
      {children}
    </div>
  );
}

function Toggle({ name, on, onChange }: { name: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="setting">
      <span className="label">{name}</span>
      <input type="checkbox" role="switch" className="sr" checked={on} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch" aria-hidden="true" />
    </label>
  );
}

function General() {
  const { settings } = useSnapshot();
  const studio = useStudio();
  return (
    <div className="groups">
      <Group title="Notifications">
        <Toggle name="When Dolly needs an answer" on={settings.notifyAsk} onChange={(notifyAsk) => studio.updateSettings({ notifyAsk })} />
        <Toggle name="When a film is ready" on={settings.notifyReady} onChange={(notifyReady) => studio.updateSettings({ notifyReady })} />
      </Group>
      <Group title="Films" note="Each film is saved as a separate file for every format you choose.">
        <Row name="Saved to"><span className="mute">Movies › Dolly</span></Row>
      </Group>
    </div>
  );
}

function AI() {
  const { settings, films } = useSnapshot();
  const studio = useStudio();
  const [editingKey, setEditingKey] = useState(false);
  const [key, setKey] = useState("");
  const [check, setCheck] = useState<{ state: "idle" | "testing" | "ok" | "failed"; text: string }>({ state: "idle", text: "" });
  const [limit, setLimit] = useState(settings.spendLimit.toFixed(2));
  const provider = PROVIDERS.find((item) => item.id === settings.provider) ?? PROVIDERS[0]!;

  useEffect(() => setLimit(settings.spendLimit.toFixed(2)), [settings.spendLimit]);

  const test = async () => {
    setCheck({ state: "testing", text: "Testing…" });
    const result = await testConnection(settings.provider, settings.endpoint);
    setCheck(result.ok ? { state: "ok", text: `Working · ${result.ms} ms` } : { state: "failed", text: result.error ?? "Not working" });
  };

  const save = async () => {
    if (!key.trim()) return setEditingKey(false);
    const hint = await saveKey(settings.provider, key.trim());
    studio.updateSettings({ keyHint: hint });
    setKey("");
    setEditingKey(false);
    void test();
  };

  const month = new Date();
  const thisMonth = films.filter((film) => {
    const made = new Date(film.createdAt);
    return made.getFullYear() === month.getFullYear() && made.getMonth() === month.getMonth();
  });
  const spent = thisMonth.reduce((sum, film) => sum + film.cost, 0);

  return (
    <div className="groups">
      <Group title="Provider">
        <Row name="Service">
          <Picker
            label="Service"
            value={settings.provider}
            options={PROVIDERS.map((item) => ({ value: item.id, name: item.name }))}
            onChange={(value) => {
              studio.updateSettings({ provider: value as SettingsData["provider"], model: "Recommended", keyHint: "" });
              setCheck({ state: "idle", text: "" });
            }}
          />
        </Row>
        {settings.provider === "custom" && (
          <Row name="Address">
            <input className="inline" style={{ width: 200 }} placeholder="https://…/v1" value={settings.endpoint} onChange={(event) => studio.updateSettings({ endpoint: event.target.value })} aria-label="Address" />
          </Row>
        )}
        <Row name="API key" detail="Kept in your system keychain.">
          {editingKey ? (
            <input
              className="inline"
              type="password"
              autoFocus
              style={{ width: 180 }}
              placeholder="Paste your key"
              aria-label="API key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              onBlur={() => void save()}
              onKeyDown={(event) => {
                if (event.key === "Enter") void save();
                if (event.key === "Escape") setEditingKey(false);
              }}
            />
          ) : (
            <button type="button" className="value" onClick={() => setEditingKey(true)}>
              {settings.keyHint ? `•••• ${settings.keyHint}` : "Add Key…"}<Chevron />
            </button>
          )}
        </Row>
        <Row name="Model" detail="Any model name the provider accepts.">
          <ModelField label="Model" value={settings.model} options={provider.models} onChange={(model) => studio.updateSettings({ model })} />
        </Row>
        <Row name="Connection">
          <button type="button" className="value" onClick={() => void test()} disabled={check.state === "testing"}>
            {check.text || "Test"}<Chevron />
          </button>
        </Row>
      </Group>
      <Group title="Cost">
        <Row name="Ask before a film costs more than" detail="A 30-second film usually costs $0.40 to $1.20.">
          <label style={{ display: "flex", alignItems: "baseline", gap: 2 }}>
            <span className="mute">$</span>
            <span className="sr">Limit in dollars</span>
            <input
              className="inline"
              inputMode="decimal"
              style={{ width: 40, textAlign: "right" }}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              onBlur={() => {
                const value = Number(limit);
                if (Number.isFinite(value) && value > 0) studio.updateSettings({ spendLimit: Math.round(value * 100) / 100 });
                else setLimit(settings.spendLimit.toFixed(2));
              }}
            />
          </label>
        </Row>
        <Row name="Spent this month"><span className="mute">{money(spent)} · {thisMonth.length} {thisMonth.length === 1 ? "film" : "films"}</span></Row>
      </Group>
    </div>
  );
}

function Safety() {
  const { settings } = useSnapshot();
  const studio = useStudio();
  const [word, setWord] = useState("");
  const add = () => {
    const next = word.trim();
    if (next && !settings.neverClick.some((item) => item.toLowerCase() === next.toLowerCase())) studio.updateSettings({ neverClick: [...settings.neverClick, next] });
    setWord("");
  };
  return (
    <div className="groups">
      <Group title="Dolly asks you" note="The default for new films. You can change it for each film.">
        <div className="texttabs" role="radiogroup" aria-label="When Dolly asks">
          {ASK_LEVELS.map((level) => (
            <button key={level.id} type="button" role="radio" aria-checked={settings.ask === level.id} onClick={() => studio.updateSettings({ ask: level.id })}>{level.name}</button>
          ))}
        </div>
      </Group>
      <Group title="Never click" note="Dolly skips any button with these words and films something else.">
        <div className="words">
          {settings.neverClick.map((item) => (
            <span key={item}>
              {item}
              <button type="button" aria-label={`Remove ${item}`} onClick={() => studio.updateSettings({ neverClick: settings.neverClick.filter((other) => other !== item) })}>×</button>
            </span>
          ))}
          <label>
            <span className="sr">Add a word</span>
            <input
              placeholder="Add a word"
              value={word}
              onChange={(event) => setWord(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === ",") {
                  event.preventDefault();
                  add();
                }
              }}
              onBlur={add}
            />
          </label>
        </div>
      </Group>
      <Group title="Control">
        <Toggle name="New films work in a private copy of the app" on={settings.privateCopy} onChange={(privateCopy) => studio.updateSettings({ privateCopy })} />
        <Toggle name="Stop the moment I move the mouse" on={settings.stopOnMouse} onChange={(stopOnMouse) => studio.updateSettings({ stopOnMouse })} />
        <Toggle name="Show where Dolly is clicking" on={settings.showPointer} onChange={(showPointer) => studio.updateSettings({ showPointer })} />
      </Group>
    </div>
  );
}

function About() {
  return (
    <div className="groups">
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <img src="/icon.svg" alt="" width={48} height={48} />
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <b style={{ fontSize: 15 }}>Dolly Studio</b>
          <span className="mute" style={{ fontSize: 12 }}>Version {__APP_VERSION__}</span>
        </span>
      </div>
      <span className="mute" style={{ fontSize: 12, lineHeight: 1.5 }}>
        Give Dolly an app and get back a promo film. Dolly explores the app, picks what to say, films it and cuts every format.
      </span>
    </div>
  );
}

/** A native pop-up button drawn as the row's value. */
function ModelField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  // A model id is whatever the provider takes, so this is typing with the
  // provider's own names offered as suggestions, not a closed list.
  const shown = value === "Recommended" ? "" : value;
  const [text, setText] = useState(shown);
  useEffect(() => setText(value === "Recommended" ? "" : value), [value]);
  const commit = () => {
    const next = text.trim();
    if (next !== shown) onChange(next || "Recommended");
  };
  return (
    <label className="value">
      <span className="sr">{label}</span>
      <input
        className="inline"
        style={{ width: 200, textAlign: "right" }}
        list="dolly-models"
        placeholder="Provider default"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") setText(shown);
        }}
      />
      <datalist id="dolly-models">
        {options.filter((model) => model !== "Recommended").map((model) => <option key={model} value={model} />)}
      </datalist>
    </label>
  );
}

function Picker({ label, value, options, onChange }: { label: string; value: string; options: { value: string; name: string }[]; onChange: (value: string) => void }) {
  return (
    <label className="value picker">
      <span className="sr">{label}</span>
      <span aria-hidden="true">{options.find((option) => option.value === value)?.name ?? value}</span>
      <Chevron />
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.name}</option>)}
      </select>
    </label>
  );
}

const Chevron = () => (
  <svg width="7" height="10" viewBox="0 0 7 10" aria-hidden="true"><path d="M1.5 1.5 5 5 1.5 8.5" fill="none" stroke="#A1A1A6" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
