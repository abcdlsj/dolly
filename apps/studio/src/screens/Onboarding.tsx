// First launch: three permissions in a numbered list. Each row turns into
// “Allowed” on its own as soon as the system says so.

import { useEffect, useState } from "react";
import { askPermission, permissions, saveKey, type Permissions } from "../platform.ts";
import { useSnapshot, useStudio } from "../state.tsx";

export function Onboarding() {
  const { settings } = useSnapshot();
  const studio = useStudio();
  const [allowed, setAllowed] = useState<Permissions>({ screen: false, accessibility: false });
  const [editing, setEditing] = useState(false);
  const [key, setKey] = useState("");

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      const now = await permissions().catch(() => null);
      if (!stop && now) setAllowed(now);
    };
    void poll();
    const timer = setInterval(() => void poll(), 1500);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const save = async () => {
    if (!key.trim()) return;
    studio.updateSettings({ keyHint: await saveKey(settings.provider, key.trim()) });
    setKey("");
    setEditing(false);
  };

  const steps = [
    { name: "Screen Recording", detail: "So Dolly can film the app.", done: allowed.screen, action: "Open Settings…", run: () => askPermission("screen") },
    { name: "Accessibility", detail: "So Dolly can click and type in the app it films.", done: allowed.accessibility, action: "Open Settings…", run: () => askPermission("accessibility") },
    { name: "AI provider", detail: "Optional — a key from Anthropic, OpenAI or another provider. You can add it later in Settings.", done: !!settings.keyHint, action: "Add Key…", run: () => setEditing(true) },
  ];
  const current = steps.findIndex((step) => !step.done);
  const ready = current === -1;
  // The key is the one step that can wait: a film needs it, but looking around
  // does not, and a first launch should not turn into a signup form.
  const permitted = allowed.screen && allowed.accessibility;

  return (
    <div className="welcome-ground">
      <div className="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title" data-drag-region>
        <div className="welcome-head">
          <img src="/icon.svg" alt="" width={72} height={72} />
          <h1 id="welcome-title">Welcome to Dolly</h1>
          <span className="mute" style={{ lineHeight: 1.5 }}>
            Give it an app and get back a promo film.<br />First, three permissions. Each takes a few seconds.
          </span>
        </div>
        <ol className="permissions">
          {steps.map((step, index) => (
            <li key={step.name}>
              <span className={step.done ? "mark done" : "mark"} aria-hidden="true">{step.done ? "✓" : index + 1}</span>
              <span style={{ flex: "1 1 auto", display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontWeight: 500 }}>{step.name}</span>
                <span className="mute" style={{ fontSize: 12 }}>{step.detail}</span>
              </span>
              {step.done ? (
                <span className="mute" style={{ fontSize: 12 }}>{index === 2 ? `•••• ${settings.keyHint}` : "Allowed"}</span>
              ) : index === 2 && editing ? (
                <input
                  className="inline"
                  type="password"
                  autoFocus
                  aria-label="API key"
                  placeholder="Paste your key"
                  style={{ width: 160 }}
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void save();
                    if (event.key === "Escape") setEditing(false);
                  }}
                  onBlur={() => void save()}
                />
              ) : (
                <button type="button" className={index === current && index < 2 ? "btn small primary" : "btn small"} onClick={step.run}>{step.action}</button>
              )}
            </li>
          ))}
        </ol>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="spacer mute" style={{ fontSize: 12 }}>
            {permitted ? (ready ? "All set." : "You can add a key later in Settings.") : "This updates on its own once you allow access."}
          </span>
          <button type="button" className="btn primary" disabled={!permitted} onClick={() => studio.updateSettings({ onboarded: true })}>Continue</button>
        </div>
      </div>
    </div>
  );
}
