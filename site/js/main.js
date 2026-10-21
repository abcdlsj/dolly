// Wires the page: one animation loop, shared clocks, and a draw function per canvas.
(function () {
  "use strict";

  const C = window.DollyCamera;
  const A = window.DollyApp;
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const MONO = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

  // MARK: - Theme

  let theme = {};
  function readTheme() {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    theme = { bg: v("--bg"), bg2: v("--bg-2"), surface: v("--surface"), ink: v("--ink"), ink2: v("--ink-2"), muted: v("--muted"), line: v("--line"), accent: v("--accent") };
    stages.forEach((s) => (s.dirty = true));
  }

  // MARK: - Clocks and stages

  // A clock loops over `length` seconds; several canvases can share one.
  function clock(length, still) {
    return { t: REDUCED ? still || 0 : 0, length, playing: !REDUCED, listeners: [] };
  }

  const stages = [];

  function stage(canvas, clk, draw) {
    const s = { canvas, ctx: canvas.getContext("2d"), clock: clk, draw, visible: false, dirty: true, w: 0, h: 0 };
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
    canvas.addEventListener("click", () => toggle(clk));
    canvas.style.cursor = "pointer";
    return s;
  }

  function toggle(clk) {
    clk.playing = !clk.playing;
    clk.listeners.forEach((f) => f());
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
      if (!s.visible || !s.w) continue;
      if (advanced.has(s.clock) || s.dirty) render(s);
    }
    for (const clk of advanced) clk.listeners.forEach((f) => f());
    requestAnimationFrame(frame);
  }

  // MARK: - Small drawing helpers

  function label(ctx, str, x, y, { size = 12, color = "#fff", bg = null, align = "left", weight = 700 } = {}) {
    ctx.font = `${weight} ${size}px ${MONO}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = align;
    if (bg) {
      const w = ctx.measureText(str).width + 12;
      const bx = align === "right" ? x - w : align === "center" ? x - w / 2 : x;
      A.rr(ctx, bx, y - size * 0.85, w, size * 1.7, 5);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.textAlign = "left";
      ctx.fillStyle = color;
      ctx.fillText(str, bx + 6, y + 1);
      return w;
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y + 1);
    return ctx.measureText(str).width;
  }

  function insetFrame(ctx, x, y, w, h) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 6;
    ctx.fillStyle = "#000";
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  function insetBorder(ctx, x, y, w, h) {
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
    ctx.restore();
  }

  const clockText = (t) => `00:${t.toFixed(2).padStart(5, "0")}`;

  // MARK: - Hero

  const hero = C.shot({ beats: A.HERO_BEATS, source: A.SOURCE, length: A.TAKE.length });
  const heroClock = clock(A.TAKE.length, 4.4);
  (function () {
    const e = hero.explain();
    const brief = { ok: e.ok, ceiling: e.ceiling, peak_pan: e.peak_pan, peak_zoom_rate: e.peak_zoom_rate, warnings: e.warnings };
    document.getElementById("hero-explain").textContent = `$ scripts/camera.py --shot shot.json --explain\n${JSON.stringify(brief)}`;
  })();

  stage(document.getElementById("hero"), heroClock, (ctx, w, h, t) => {
    A.drawFilm(ctx, hero.camera, t, 0, 0, w, h, t);
    const [z] = hero.camera.view(t);
    const small = w < 560;
    label(ctx, `● FILM 16:9  ${z.toFixed(2)}×  ${clockText(t)}`, 12, 22, { size: small ? 10 : 12, bg: "rgba(20,18,28,0.6)" });
    const iw = Math.max(w * (small ? 0.36 : 0.27), 110);
    const ih = (iw * 9) / 16;
    const ix = w - iw - 12;
    const iy = h - ih - 12;
    insetFrame(ctx, ix, iy, iw, ih);
    A.drawOverview(ctx, hero.camera, t, ix, iy, iw, ih, { trail: 1.5, label: false });
    insetBorder(ctx, ix, iy, iw, ih);
    label(ctx, "TAKE", ix + 6, iy + 12, { size: 9, bg: "rgba(20,18,28,0.7)" });
  });

  // Beat chips under the hero, and a play/pause button.
  (function heroTimeline() {
    const root = document.getElementById("hero-timeline");
    const track = root.querySelector(".track");
    const head = root.querySelector(".playhead");
    const chips = hero.beats.map((b) => {
      const el = document.createElement("div");
      el.className = "beat";
      el.textContent = b.move;
      el.style.left = `${(b.start / hero.length) * 100}%`;
      el.style.width = `calc(${(Math.max(b.end - b.start, 0.35) / hero.length) * 100}% - 3px)`;
      el.title = `${b.move} ${b.start.toFixed(2)}–${b.end.toFixed(2)} s`;
      track.appendChild(el);
      return [el, b];
    });
    const button = document.querySelector('.playpause[data-for="hero"]');
    button.addEventListener("click", () => toggle(heroClock));
    const update = () => {
      const t = heroClock.t;
      head.style.left = `${(t / hero.length) * 100}%`;
      chips.forEach(([el, b]) => el.classList.toggle("on", t >= b.start && t < Math.max(b.end, b.start + 0.35)));
      button.textContent = heroClock.playing ? "❚❚" : "▶";
      button.setAttribute("aria-label", heroClock.playing ? "Pause" : "Play");
    };
    heroClock.listeners.push(update);
    update();
  })();

  // MARK: - 01 Drive

  const driveClock = clock(A.TAKE.length, 2.6);
  const terminal = document.getElementById("drive-terminal");
  const escape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const DONE = [0.25, 3.0, 5.6, 7.4];
  let terminalState = "";

  stage(document.getElementById("drive"), driveClock, (ctx, w, h, t) => {
    ctx.save();
    ctx.scale(w / A.WIN_W, h / A.WIN_H);
    A.drawWindow(ctx, t);
    ctx.restore();
    const s = A.takeState(t);
    if (s.pressed) label(ctx, "mouse down", 12, h - 20, { size: 11, bg: theme.accent || "#FF7A45" });
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
    html += '<span class="caret"></span>';
    if (state !== terminalState) {
      terminalState = state;
      terminal.innerHTML = html;
    }
  });

  // MARK: - 02 Record

  const recordClock = clock(A.TAKE.length, 4.2);
  const FPS = 61.2;

  stage(document.getElementById("record"), recordClock, (ctx, w, h, t) => {
    ctx.fillStyle = "#14121C";
    ctx.fillRect(0, 0, w, h);
    const pad = Math.max(12, w * 0.025);
    const small = w < 520;

    // the window, live, as screencapture sees it
    const lh = h * 0.5;
    const lw = (lh * 16) / 9;
    ctx.save();
    ctx.translate(pad, pad);
    ctx.scale(lw / A.WIN_W, lh / A.WIN_H);
    A.drawWindow(ctx, t);
    ctx.restore();
    const blink = Math.floor(t * 2) % 2 === 0;
    ctx.strokeStyle = "#FF5F57";
    ctx.lineWidth = 2;
    ctx.strokeRect(pad - 1, pad - 1, lw + 2, lh + 2);
    label(ctx, `${blink ? "●" : "○"} REC  window 61527`, pad + 6, pad + 14, { size: small ? 9 : 11, bg: "rgba(255,95,87,0.92)" });

    // counters
    const cx = pad * 2 + lw;
    const frames = Math.floor(t * FPS);
    const rows = [["frames", String(frames)], ["fps", FPS.toFixed(1)], ["seconds", t.toFixed(2)], ["loops", "4"]];
    const size = small ? 10 : Math.min(15, w / 48);
    rows.forEach(([k, v], i) => {
      const y = pad + size + i * size * 2.1;
      label(ctx, k, cx, y, { size: size * 0.85, color: "#9C95A8", weight: 600 });
      label(ctx, v, cx, y + size * 0.95, { size, color: "#FFF8EE" });
    });

    // the film strip: one thumbnail per ~30 captured frames, newest on the right
    const by = pad * 2 + lh;
    const bh = h - by - pad * 0.6;
    const fh = bh * 0.62;
    const fw = (fh * 16) / 9;
    const gap = fw * 0.08;
    const step = 0.5;
    ctx.fillStyle = "#0B0A10";
    ctx.fillRect(0, by, w, bh);
    // sprocket holes
    ctx.fillStyle = "#26232F";
    const holes = Math.ceil(w / 14) + 1;
    const holeShift = ((t / step) * (fw + gap)) % 14;
    for (let i = 0; i < holes; i++) {
      const x = i * 14 - holeShift;
      ctx.fillRect(x, by + 4, 7, 5);
      ctx.fillRect(x, by + bh - 9, 7, 5);
    }
    const right = w - pad;
    const n = Math.floor(t / step);
    for (let k = n; k >= 0; k--) {
      const x = right - fw - (t / step - k) * (fw + gap);
      if (x + fw < 0) break;
      const y = by + (bh - fh) / 2 - 4;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, fw, fh);
      ctx.clip();
      ctx.translate(x, y);
      ctx.scale(fw / A.WIN_W, fh / A.WIN_H);
      A.drawWindow(ctx, k * step);
      ctx.restore();
      // a flash on the frame just captured
      const age = t - k * step;
      if (age < 0.15) {
        ctx.fillStyle = `rgba(255,255,255,${0.6 * (1 - age / 0.15)})`;
        ctx.fillRect(x, y, fw, fh);
      }
      const ms = Math.round(k * step * 1000 + 412);
      label(ctx, `${ms}.png`, x + fw / 2, y + fh + Math.max(8, bh * 0.1), { size: Math.max(8, Math.min(11, fw / 11)), color: "#9C95A8", align: "center", weight: 600 });
    }
  });

  // MARK: - 03 Move

  stage(document.getElementById("move"), heroClock, (ctx, w, h, t) => {
    A.drawOverview(ctx, hero.camera, t, 0, 0, w, h, { trail: 3, windowTime: t });
    const iw = Math.max(w * 0.32, 120);
    const ih = (iw * 9) / 16;
    const ix = w - iw - 12;
    const iy = h - ih - 12;
    insetFrame(ctx, ix, iy, iw, ih);
    A.drawFilm(ctx, hero.camera, t, ix, iy, iw, ih, t);
    insetBorder(ctx, ix, iy, iw, ih);
    label(ctx, "FILM", ix + 6, iy + 12, { size: 9, bg: "rgba(20,18,28,0.7)" });
  });

  // MARK: - Named moves

  const P = A.POINTS;
  const R = (r) => r.map((v) => Math.round(v * 1000) / 1000);

  const PRESETS = [
    {
      id: "focus",
      blurb: "Push in on a control. With a rect, the zoom is chosen so it fills `fill` of the frame — here the hovered card at 35%.",
      beats: [{ move: "hold", for: 0.6 }, { move: "focus", rect: R(A.RECTS.card), fill: 0.35 }, { move: "hold", for: 1.2 }, { move: "pull-back" }],
    },
    {
      id: "frame",
      blurb: "Re-frame: zoom and centre move together and arrive at the same moment. Good for a section rather than a control.",
      beats: [{ move: "hold", for: 0.6 }, { move: "frame", point: P.backlog, zoom: 1.4 }, { move: "hold", for: 1.2 }, { move: "pull-back" }],
    },
    {
      id: "pan-to",
      blurb: "Keep the zoom, move the centre. One move per beat: settle on the zoom first, then pan, so it never reads as a mistake.",
      beats: [
        { move: "hold", for: 0.6 }, { move: "frame", point: P.sidebar, zoom: 1.5 },
        { move: "pan-to", at: "+0.6", point: P.card, for: 1.8 }, { move: "pan-to", at: "+0.6", point: P.done, for: 1.8 },
        { move: "hold", for: 0.8 }, { move: "pull-back" },
      ],
    },
    {
      id: "punch-in",
      blurb: "A short emphasis push with a small overshoot (`back` ease). Land it on the frame where something happens — a drop, a toast.",
      beats: [
        { move: "hold", for: 0.6 }, { move: "frame", point: P.card, zoom: 1.3 }, { move: "hold", for: 0.8 },
        { move: "punch-in", amount: 1.15 }, { move: "hold", for: 1.2 }, { move: "pull-back" },
      ],
    },
    {
      id: "drift",
      blurb: "A slow linear creep for a long static beat, so five seconds of one frame doesn't read as a crash.",
      beats: [{ move: "hold", for: 0.6 }, { move: "drift", for: 4.4, amount: 1.1 }, { move: "pull-back", for: 1.4 }],
    },
    {
      id: "tour",
      blurb: "Visit several points at one zoom. The spline glides through the stops instead of stopping dead at each one.",
      beats: [
        { move: "hold", for: 0.6 },
        { move: "tour", zoom: 1.45, stops: [P.sidebar, P.card, P.done], travel: 1.6, hold: 0.7 },
        { move: "pull-back", at: "+0.2" },
      ],
    },
  ];

  const movesClock = clock(1, 2.4);
  let current = null;
  const WINDOW_TIME = 2.6; // the hover tooltip is up

  function select(preset) {
    const planned = C.shot({ beats: preset.beats, source: A.SOURCE });
    const length = planned.keys[planned.keys.length - 1].t + 0.8;
    current = C.shot({ beats: preset.beats, source: A.SOURCE, length });
    current.preset = preset;
    movesClock.length = length;
    movesClock.t = REDUCED ? Math.min(length * 0.45, length - 0.01) : 0;
    document.querySelectorAll("#move-tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.id === preset.id)));
    document.getElementById("move-blurb").innerHTML = escape(preset.blurb).replace(/`([^`]+)`/g, "<code>$1</code>");
    document.getElementById("move-json").innerHTML = highlight(shotJSON(preset.beats));
    document.getElementById("move-explain").innerHTML = highlight(explainJSON(current.explain()));
    stages.forEach((s) => (s.dirty = true));
  }

  function shotJSON(beats) {
    const lines = beats.map((b) => "    " + JSON.stringify(b).replace(/,(?=["\[\d-])/g, ", ").replace(/":/g, '": ').replace(/^\{/, "{ ").replace(/\}$/, " }"));
    return `{\n  "source": "take.mov",\n  "output": { "aspect": "16:9", "fit": "pad" },\n  "beats": [\n${lines.join(",\n")}\n  ]\n}`;
  }

  function explainJSON(e) {
    const scalar = ["ok", "ceiling", "length", "peak_pan", "peak_zoom_rate"].map((k) => `  "${k}": ${JSON.stringify(e[k])}`);
    const keys = e.keys.map((k) => `    "${k}"`).join(",\n");
    const warnings = e.warnings.length ? `[\n${e.warnings.map((w) => `    ${JSON.stringify(w)}`).join(",\n")}\n  ]` : "[]";
    return `{\n${scalar.join(",\n")},\n  "keys": [\n${keys}\n  ],\n  "warnings": ${warnings}\n}`;
  }

  function highlight(json) {
    return escape(json)
      .replace(/"([^"\n]+)":/g, '<span class="key">"$1"</span>:')
      .replace(/: "([^"\n]*)"/g, ': <span class="str">"$1"</span>')
      .replace(/^(\s+)"(\d[^"\n]*)"/gm, '$1<span class="str">"$2"</span>')
      .replace(/^(\s+)("(?:beat|camera|pan|zoom|last|drift|focus|frame|tour|punch)[^\n]*")/gm, '$1<span class="warn">$2</span>')
      .replace(/([:\[,] ?)(-?\d+\.?\d*)(?=[,\s\]}])/g, '$1<span class="num">$2</span>');
  }

  (function tabs() {
    const root = document.getElementById("move-tabs");
    PRESETS.forEach((p) => {
      const b = document.createElement("button");
      b.type = "button";
      b.role = "tab";
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
    const [z] = current.camera.view(t);
    const beat = current.beats.find((b) => t >= b.start && t < Math.max(b.end, b.start + 0.35));
    label(ctx, `${z.toFixed(2)}×`, w - 10, 20, { size: 11, bg: "rgba(20,18,28,0.6)", align: "right" });
    if (beat) label(ctx, beat.move, 10, h - 18, { size: 11, bg: beat.move === "hold" ? "rgba(20,18,28,0.6)" : theme.accent || "#FF7A45" });
  });

  stage(document.getElementById("moves-chart"), movesClock, (ctx, w, h, t) => {
    const shot = current;
    const L = 46;
    const Rm = 14;
    const T = 42;
    const B = 22;
    const pw = w - L - Rm;
    const ph = h - T - B;
    const X = (s) => L + (s / shot.length) * pw;
    const zMax = Math.max(shot.ceiling, 1.05);
    const Yz = (z) => T + ph - ((Math.log(z) - 0) / Math.log(zMax)) * ph;
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, 0, w, h);

    // beats
    shot.beats.forEach((b, i) => {
      if (b.move === "hold") return;
      const x0 = X(b.start);
      const x1 = X(Math.max(b.end, b.start + 0.3));
      ctx.fillStyle = i % 2 ? "rgba(255,122,69,0.08)" : "rgba(255,122,69,0.14)";
      ctx.fillRect(x0, T, x1 - x0, ph);
      label(ctx, b.move, x0 + 3, T - 11, { size: 10, color: theme.muted, weight: 600 });
    });

    // axes
    ctx.strokeStyle = theme.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L, T + ph + 0.5);
    ctx.lineTo(L + pw, T + ph + 0.5);
    ctx.stroke();
    [1, shot.ceiling].forEach((z) => {
      const y = Yz(z);
      ctx.setLineDash(z === 1 ? [] : [3, 4]);
      ctx.beginPath();
      ctx.moveTo(L, y);
      ctx.lineTo(L + pw, y);
      ctx.stroke();
      ctx.setLineDash([]);
      label(ctx, `${z.toFixed(2)}×`, L - 6, y, { size: 10, color: theme.muted, align: "right", weight: 600 });
    });
    label(ctx, "ceiling", L + pw - 2, Yz(shot.ceiling) + 9, { size: 9, color: theme.muted, align: "right", weight: 600 });
    for (let s = 0; s <= shot.length; s += 1) {
      label(ctx, `${s}s`, X(s), T + ph + 12, { size: 9, color: theme.muted, align: "center", weight: 600 });
    }

    // pan (x of the frame's centre), drawn faint across the full height
    ctx.beginPath();
    for (let i = 0; i <= 200; i++) {
      const s = (i / 200) * shot.length;
      const [, cx] = shot.camera.view(s);
      const y = T + ph - cx * ph;
      if (i) ctx.lineTo(X(s), y);
      else ctx.moveTo(X(s), y);
    }
    ctx.strokeStyle = "#4C7DFF";
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // zoom
    ctx.beginPath();
    for (let i = 0; i <= 300; i++) {
      const s = (i / 300) * shot.length;
      const y = Yz(shot.camera.view(s)[0]);
      if (i) ctx.lineTo(X(s), y);
      else ctx.moveTo(X(s), y);
    }
    ctx.strokeStyle = theme.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // keyframes
    shot.keys.forEach((k) => {
      ctx.beginPath();
      ctx.arc(X(k.t), Yz(Math.min(Math.max(k.zoom, 1), shot.ceiling)), 3, 0, Math.PI * 2);
      ctx.fillStyle = theme.surface;
      ctx.fill();
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // playhead
    const px = X(t);
    ctx.strokeStyle = theme.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, T);
    ctx.lineTo(px, T + ph);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(px, Yz(shot.camera.view(t)[0]), 5, 0, Math.PI * 2);
    ctx.fillStyle = theme.accent;
    ctx.fill();

    // legend
    const lx = L;
    ctx.fillStyle = theme.accent;
    ctx.fillRect(lx, 8, 14, 3);
    const zw = label(ctx, "zoom", lx + 18, 10, { size: 10, color: theme.ink2, weight: 600 });
    ctx.fillStyle = "#4C7DFF";
    ctx.fillRect(lx + 30 + zw, 8, 14, 3);
    label(ctx, "pan x", lx + 48 + zw, 10, { size: 10, color: theme.ink2, weight: 600 });
  });

  // MARK: - Eases

  const EASE_ROWS = ["linear", "inOut", "out", "inQuint"];
  const easeClock = clock(4.4, 1.0);

  function easeProgress(t) {
    // hold, travel out, hold, travel back, hold
    if (t < 0.4) return [0, 1];
    if (t < 1.8) return [(t - 0.4) / 1.4, 1];
    if (t < 2.4) return [1, 1];
    if (t < 3.8) return [(t - 2.4) / 1.4, -1];
    return [1, -1];
  }

  stage(document.getElementById("eases"), easeClock, (ctx, w, h, t) => {
    ctx.fillStyle = theme.surface;
    ctx.fillRect(0, 0, w, h);
    const narrow = w < 560;
    const rowH = h / EASE_ROWS.length;
    const labelW = narrow ? 70 : 96;
    const graphW = narrow ? 0 : Math.min(rowH * 1.4, 120);
    const x0 = labelW + 14;
    const x1 = w - graphW - (graphW ? 36 : 22);
    const [u, dir] = easeProgress(t);
    EASE_ROWS.forEach((name, i) => {
      const f = C.POINTER_EASES[name];
      const cy = rowH * (i + 0.5);
      if (i) {
        ctx.fillStyle = theme.line;
        ctx.fillRect(0, rowH * i, w, 1);
      }
      label(ctx, `--ease`, 14, cy - 8, { size: 10, color: theme.muted, weight: 600 });
      label(ctx, name, 14, cy + 8, { size: narrow ? 12 : 14, color: name === "inOut" ? theme.accent : theme.ink });
      // track and evenly-timed ghosts: their spacing is the ease
      ctx.strokeStyle = theme.line;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x0, cy);
      ctx.lineTo(x1, cy);
      ctx.stroke();
      for (let k = 0; k <= 12; k++) {
        const x = x0 + f(k / 12) * (x1 - x0);
        ctx.beginPath();
        ctx.arc(x, cy, 2.5, 0, Math.PI * 2);
        ctx.fillStyle = theme.muted;
        ctx.globalAlpha = 0.45;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      const p = dir > 0 ? f(u) : 1 - f(u);
      A.drawPointer(ctx, [x0 + p * (x1 - x0), cy - 6], false);
      // the curve
      if (graphW) {
        const gx = w - graphW - 18;
        const gh = Math.min(rowH - 22, graphW * 0.7);
        const gy = cy - gh / 2;
        ctx.strokeStyle = theme.line;
        ctx.lineWidth = 1;
        ctx.strokeRect(gx, gy, graphW, gh);
        ctx.beginPath();
        for (let k = 0; k <= 40; k++) {
          const x = gx + (k / 40) * graphW;
          const y = gy + gh - f(k / 40) * gh;
          if (k) ctx.lineTo(x, y);
          else ctx.moveTo(x, y);
        }
        ctx.strokeStyle = name === "inOut" ? theme.accent : theme.ink2;
        ctx.lineWidth = 2;
        ctx.stroke();
        const uu = dir > 0 ? u : 1 - u;
        ctx.beginPath();
        ctx.arc(gx + uu * graphW, gy + gh - (dir > 0 ? f(u) : 1 - f(u)) * gh, 3.5, 0, Math.PI * 2);
        ctx.fillStyle = theme.accent;
        ctx.fill();
      }
    });
  });

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
    const plan = C.shot({ beats, source: A.SOURCE, aspect: formatState.aspect, fit: formatState.fit });
    const length = plan.keys[plan.keys.length - 1].t + 0.8;
    formatShot = C.shot({ beats, source: A.SOURCE, aspect: formatState.aspect, fit: formatState.fit, length });
    formatClock.length = length;
    if (formatClock.t >= length) formatClock.t = 0;
    const [canW, canH, offX, offY] = formatShot.camera.canvas;
    const rows = [
      ["source", `${A.SOURCE[0]}×${A.SOURCE[1]} (2× of 1600×900)`],
      ["output", `${formatShot.out[0]}×${formatShot.out[1]}`],
      ["canvas", `${canW}×${canH}`],
      ["window at", `${offX}, ${offY}`],
      ["ceiling", formatShot.ceiling.toFixed(3)],
      ["focus asks", "2.000×"],
    ];
    const dl = document.getElementById("format-readout");
    dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("") +
      formatShot.warnings.filter((w) => !/still|moves at/.test(w)).map((w) => `<dd class="warn">⚠ ${escape(w)}</dd>`).join("");
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
    ctx.fillStyle = theme.bg2;
    ctx.fillRect(0, 0, w, h);
    const [ow, oh] = formatShot.out;
    const margin = 28;
    const s = Math.min((w - margin * 2) / ow, (h - margin * 2 - 16) / oh);
    const fw = ow * s;
    const fh = oh * s;
    const fx = (w - fw) / 2;
    const fy = (h - fh - 16) / 2;
    insetFrame(ctx, fx, fy, fw, fh);
    A.drawFilm(ctx, formatShot.camera, t, fx, fy, fw, fh, WINDOW_TIME);
    const [z] = formatShot.camera.view(t);
    label(ctx, `${formatState.aspect}  ·  ${ow}×${oh}  ·  ${z.toFixed(2)}×`, w / 2, fy + fh + 16, { size: 11, color: theme.ink2, align: "center", weight: 600 });
  });

  // MARK: - Copy buttons

  document.querySelectorAll(".copyable").forEach((pre) => {
    const b = document.createElement("button");
    b.className = "copy";
    b.type = "button";
    b.textContent = "copy";
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(pre.firstChild.textContent.trim());
        b.textContent = "copied";
      } catch {
        b.textContent = "select";
      }
      setTimeout(() => (b.textContent = "copy"), 1400);
    });
    pre.appendChild(b);
  });

  // MARK: - Start

  readTheme();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", readTheme);
  select(PRESETS[0]);
  buildFormat();
  driveClock.listeners.forEach((f) => f());
  requestAnimationFrame(frame);
})();
