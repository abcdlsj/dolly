// Wires the page: one animation loop, shared clocks, and a draw function per canvas.
(function () {
  "use strict";

  const C = window.DollyCamera;
  const A = window.DollyApp;
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const TEXT = '"Archivo", "Helvetica Neue", Arial, sans-serif';

  // MARK: - Theme

  const stages = [];
  let theme = {};
  function readTheme() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    theme = { paper: v("--paper"), ink: v("--ink"), ink2: v("--ink-2"), rule: v("--rule"), accent: v("--accent") };
    stages.forEach((s) => (s.dirty = true));
  }

  // MARK: - Clocks and stages

  // A clock loops over `length` seconds; several canvases can share one.
  function clock(length, still) {
    return { t: REDUCED ? still || 0 : 0, length, playing: !REDUCED, listeners: [] };
  }

  const visibility = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const s = stages.find((x) => x.canvas === e.target);
      if (s) {
        s.visible = e.isIntersecting;
        s.dirty = true;
      }
    }
  }, { rootMargin: "80px" });

  function stage(canvas, clk, draw, { toggles = true } = {}) {
    const s = { canvas, ctx: canvas.getContext("2d"), clock: clk, draw, visible: false, dirty: true, w: 0, h: 0, dpr: 1 };
    stages.push(s);
    new ResizeObserver(() => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      s.w = canvas.clientWidth;
      s.h = canvas.clientHeight;
      canvas.width = Math.round(s.w * dpr);
      canvas.height = Math.round(s.h * dpr);
      s.dpr = dpr;
      // Resizing clears the canvas, so paint it now even if it is off screen.
      if (s.w) render(s);
    }).observe(canvas);
    visibility.observe(canvas);
    if (toggles) canvas.addEventListener("click", () => (clk.playing = !clk.playing));
    return s;
  }

  function render(s) {
    s.dirty = false;
    const ctx = s.ctx;
    ctx.setTransform(s.dpr, 0, 0, s.dpr, 0, 0);
    ctx.clearRect(0, 0, s.w, s.h);
    s.draw(ctx, s.w, s.h, s.clock.t);
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const advanced = new Set();
    for (const s of stages) {
      const clk = s.clock;
      if (s.visible && clk.playing && !advanced.has(clk)) {
        clk.t = (clk.t + dt) % clk.length;
        advanced.add(clk);
      }
    }
    for (const s of stages) {
      if (s.visible && s.w && (advanced.has(s.clock) || s.dirty)) render(s);
    }
    for (const clk of advanced) clk.listeners.forEach((f) => f());
    requestAnimationFrame(frame);
  }

  // MARK: - Helpers

  function text(ctx, str, x, y, { size = 13, color, align = "left", weight = 600 } = {}) {
    ctx.font = `${weight} ${size}px ${TEXT}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = align;
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  // A small picture-in-picture, framed in white.
  function inset(ctx, w, h, share, paint) {
    const iw = Math.max(w * share, 120);
    const ih = (iw * 9) / 16;
    const x = w - iw - 14;
    const y = h - ih - 14;
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.5)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, iw, ih);
    ctx.restore();
    paint(x, y, iw, ih);
    ctx.strokeStyle = "rgba(255,255,255,0.9)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, iw - 1.5, ih - 1.5);
  }

  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

  // MARK: - Hero: the film, with the take and its camera inset

  const hero = C.shot({ beats: A.HERO_BEATS, source: A.SOURCE, length: A.TAKE.length });
  const heroClock = clock(A.TAKE.length, 4.4);

  stage(document.getElementById("hero"), heroClock, (ctx, w, h, t) => {
    A.drawFilm(ctx, hero.camera, t, 0, 0, w, h, t);
    inset(ctx, w, h, w < 560 ? 0.36 : 0.24, (x, y, iw, ih) =>
      A.drawOverview(ctx, hero.camera, t, x, y, iw, ih, { trail: 1.5, label: false }));
  });

  // MARK: - Drive

  const driveClock = clock(A.TAKE.length, 2.6);
  const terminal = document.getElementById("drive-terminal");
  const DONE = [0.25, 3.0, 5.6, 7.4];
  let terminalState = "";

  stage(document.getElementById("drive"), driveClock, (ctx, w, h, t) => {
    ctx.scale(w / A.WIN_W, h / A.WIN_H);
    A.drawWindow(ctx, t);
  });

  driveClock.listeners.push(() => {
    const t = driveClock.t;
    let html = "";
    let state = "";
    A.TAKE.commands.forEach((c, i) => {
      if (t < c.at) return;
      html += `<span class="prompt">$</span> ${escape(c.cmd)}\n`;
      state += i;
      if (t >= DONE[i]) {
        html += `<span class="out">${escape(c.out)}</span>\n`;
        state += "o";
      }
    });
    if (state !== terminalState) {
      terminalState = state;
      terminal.innerHTML = html + '<span class="caret"></span>';
    }
  });

  // MARK: - Record: the live window, and frames streaming into a strip

  const recordClock = clock(A.TAKE.length, 4.2);
  const FPS = 61.2;

  stage(document.getElementById("record"), recordClock, (ctx, w, h, t) => {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
    const pad = Math.max(14, w * 0.03);

    const lh = h * 0.52;
    const lw = (lh * 16) / 9;
    ctx.save();
    ctx.translate(pad, pad);
    ctx.scale(lw / A.WIN_W, lh / A.WIN_H);
    A.drawWindow(ctx, t);
    ctx.restore();
    ctx.strokeStyle = "#FF453A";
    ctx.lineWidth = 2;
    ctx.strokeRect(pad - 1, pad - 1, lw + 2, lh + 2);
    if (Math.floor(t * 2) % 2 === 0) {
      ctx.beginPath();
      ctx.arc(pad + 14, pad + 14, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#FF453A";
      ctx.fill();
    }

    // the frame count, large
    const cx = pad * 2 + lw;
    const big = Math.min(lh * 0.42, (w - cx - pad) / 3.4);
    ctx.save();
    ctx.font = `800 ${big}px ${TEXT}`;
    ctx.fontStretch = "expanded";
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fillStyle = "#F1F1EE";
    ctx.fillText(String(Math.floor(t * FPS)), cx, pad + big * 0.85);
    ctx.restore();
    text(ctx, `frames · ${FPS} fps`, cx, pad + big * 0.85 + 22, { size: Math.max(12, big * 0.2), color: "#8D8A96", weight: 500 });

    // the strip: one thumbnail per ~30 captured frames, newest on the right
    const by = pad * 2 + lh;
    const bh = h - by;
    const fh = bh * 0.7;
    const fw = (fh * 16) / 9;
    const gap = fw * 0.06;
    const step = 0.5;
    const right = w - pad;
    const y = by + (bh - fh) / 2 - 2;
    for (let k = Math.floor(t / step); k >= 0; k--) {
      const x = right - fw - (t / step - k) * (fw + gap);
      if (x + fw < 0) break;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, fw, fh);
      ctx.clip();
      ctx.translate(x, y);
      ctx.scale(fw / A.WIN_W, fh / A.WIN_H);
      A.drawWindow(ctx, k * step);
      ctx.restore();
      const age = t - k * step;
      if (age < 0.15) {
        ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - age / 0.15)})`;
        ctx.fillRect(x, y, fw, fh);
      }
    }
  });

  // MARK: - Move: the camera's frame over the take, the film inset

  stage(document.getElementById("move"), heroClock, (ctx, w, h, t) => {
    A.drawOverview(ctx, hero.camera, t, 0, 0, w, h, { trail: 3 });
    inset(ctx, w, h, 0.3, (x, y, iw, ih) => A.drawFilm(ctx, hero.camera, t, x, y, iw, ih, t));
  });

  // MARK: - Named moves

  const P = A.POINTS;
  const R = (r) => r.map((v) => Math.round(v * 1000) / 1000);

  const PRESETS = [
    {
      id: "focus",
      beats: [{ move: "hold", for: 0.6 }, { move: "focus", rect: R(A.RECTS.card), fill: 0.35 }, { move: "hold", for: 1.2 }, { move: "pull-back" }],
    },
    {
      id: "frame",
      beats: [{ move: "hold", for: 0.6 }, { move: "frame", point: P.backlog, zoom: 1.4 }, { move: "hold", for: 1.2 }, { move: "pull-back" }],
    },
    {
      id: "pan-to",
      beats: [
        { move: "hold", for: 0.6 }, { move: "frame", point: P.sidebar, zoom: 1.5 },
        { move: "pan-to", at: "+0.6", point: P.card, for: 1.8 }, { move: "pan-to", at: "+0.6", point: P.done, for: 1.8 },
        { move: "hold", for: 0.8 }, { move: "pull-back" },
      ],
    },
    {
      id: "punch-in",
      beats: [
        { move: "hold", for: 0.6 }, { move: "frame", point: P.card, zoom: 1.3 }, { move: "hold", for: 0.8 },
        { move: "punch-in", amount: 1.15 }, { move: "hold", for: 1.2 }, { move: "pull-back" },
      ],
    },
    {
      id: "drift",
      beats: [{ move: "hold", for: 0.6 }, { move: "drift", for: 4.4, amount: 1.1 }, { move: "pull-back", for: 1.4 }],
    },
    {
      id: "tour",
      beats: [
        { move: "hold", for: 0.6 },
        { move: "tour", zoom: 1.45, stops: [P.sidebar, P.card, P.done], travel: 1.6, hold: 0.7 },
        { move: "pull-back", at: "+0.2" },
      ],
    },
  ];

  const movesClock = clock(1, 2.4);
  const WINDOW_TIME = 2.6; // the hover tooltip is up
  let current = null;

  function select(preset) {
    const planned = C.shot({ beats: preset.beats, source: A.SOURCE });
    const length = planned.keys[planned.keys.length - 1].t + 0.8;
    current = C.shot({ beats: preset.beats, source: A.SOURCE, length });
    movesClock.length = length;
    movesClock.t = REDUCED ? length * 0.45 : 0;
    document.querySelectorAll("#move-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === preset.id)));
    document.getElementById("move-json").innerHTML = highlight(preset.beats);
    stages.forEach((s) => (s.dirty = true));
  }

  // The beats as a shot file would list them, one per line.
  function highlight(beats) {
    const line = (b) => "  " + JSON.stringify(b).replace(/,(?=["\[\d-])/g, ", ").replace(/":/g, '": ').replace(/^\{/, "{ ").replace(/\}$/, " }");
    return escape(`"beats": [\n${beats.map(line).join(",\n")}\n]`)
      .replace(/"([^"\n]+)":/g, '<span class="key">"$1"</span>:')
      .replace(/(-?\d+\.\d+|\b\d+\b)(?=[,\s\]}])/g, '<span class="num">$1</span>');
  }

  (function tabs() {
    const root = document.getElementById("move-tabs");
    PRESETS.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.dataset.id = p.id;
      b.textContent = p.id;
      b.addEventListener("click", () => select(p));
      root.appendChild(b);
    });
  })();

  stage(document.getElementById("moves-overview"), movesClock, (ctx, w, h, t) => {
    A.drawOverview(ctx, current.camera, t, 0, 0, w, h, { trail: 6, windowTime: WINDOW_TIME });
  });

  stage(document.getElementById("moves-film"), movesClock, (ctx, w, h, t) => {
    A.drawFilm(ctx, current.camera, t, 0, 0, w, h, WINDOW_TIME);
  });

  // Zoom over time: the beats as bands, the curve, the playhead.
  stage(document.getElementById("moves-chart"), movesClock, (ctx, w, h, t) => {
    const shot = current;
    const top = 26;
    const ph = h - top - 2;
    const X = (s) => (s / shot.length) * w;
    const Y = (z) => top + ph - (Math.log(z) / Math.log(Math.max(shot.ceiling, 1.05))) * ph * 0.92;

    shot.beats.forEach((b) => {
      if (b.move === "hold") return;
      const x0 = X(b.start);
      ctx.fillStyle = theme.rule;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(x0, top, X(Math.max(b.end, b.start + 0.3)) - x0, ph);
      ctx.globalAlpha = 1;
      text(ctx, b.move, x0, 10, { size: 13, color: theme.ink2, weight: 600 });
    });

    ctx.strokeStyle = theme.rule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, top + ph + 0.5);
    ctx.lineTo(w, top + ph + 0.5);
    ctx.stroke();

    ctx.beginPath();
    for (let i = 0; i <= 300; i++) {
      const s = (i / 300) * shot.length;
      const y = Y(shot.camera.view(s)[0]);
      if (i) ctx.lineTo(X(s), y);
      else ctx.moveTo(X(s), y);
    }
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 2;
    ctx.stroke();

    const px = X(t);
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, top);
    ctx.lineTo(px, top + ph);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, Y(shot.camera.view(t)[0]), 5, 0, Math.PI * 2);
    ctx.fillStyle = theme.accent;
    ctx.fill();
  }, { toggles: false });

  // MARK: - Formats

  const formatState = { aspect: "16:9", fit: "pad" };
  const formatClock = clock(6, 3.0);
  let formatShot = null;

  function buildFormat() {
    const beats = [
      { move: "hold", for: 0.6 },
      { move: "focus", point: P.card, zoom: 2.0, for: 2.4 },
      { move: "hold", for: 1.2 },
      { move: "pull-back", for: 2.4 },
    ];
    const opts = { beats, source: A.SOURCE, aspect: formatState.aspect, fit: formatState.fit };
    const plan = C.shot(opts);
    const length = plan.keys[plan.keys.length - 1].t + 0.8;
    formatShot = C.shot({ ...opts, length });
    formatClock.length = length;
    if (formatClock.t >= length) formatClock.t = 0;
    const c = formatShot.ceiling;
    document.getElementById("format-note").innerHTML = `ceiling <b>${c.toFixed(2)}×</b>` + (c < 2 ? " · 2× clamped" : "");
    stages.forEach((s) => (s.dirty = true));
  }

  function segmented(id, key) {
    const root = document.getElementById(id);
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      formatState[key] = b.dataset[key];
      root.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      buildFormat();
    });
  }
  segmented("aspect-buttons", "aspect");
  segmented("fit-buttons", "fit");

  stage(document.getElementById("format"), formatClock, (ctx, w, h, t) => {
    const [ow, oh] = formatShot.out;
    const s = Math.min(w / ow, h / oh);
    const fw = ow * s;
    const fh = oh * s;
    A.drawFilm(ctx, formatShot.camera, t, (w - fw) / 2, (h - fh) / 2, fw, fh, WINDOW_TIME);
  });

  // MARK: - Copy

  document.querySelectorAll(".copyable").forEach((pre) => {
    const source = pre.textContent.trim();
    const b = document.createElement("button");
    b.className = "copy-btn";
    b.type = "button";
    b.textContent = "copy";
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(source);
        b.textContent = "copied";
      } catch {
        const range = document.createRange();
        range.selectNodeContents(pre.firstChild);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
      }
      setTimeout(() => (b.textContent = "copy"), 1400);
    });
    pre.appendChild(b);
  });

  // MARK: - Start

  readTheme();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readTheme);
  new MutationObserver(readTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (document.fonts) document.fonts.ready.then(() => stages.forEach((s) => (s.dirty = true)));
  select(PRESETS[0]);
  buildFormat();
  driveClock.listeners.forEach((f) => f());
  requestAnimationFrame(frame);
})();
