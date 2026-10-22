// The window being filmed: a small task board, a pointer that hovers and drags
// a card across it, and the drawing of any take through a camera.
(function (global) {
  "use strict";

  const { POINTER_EASES } = global.DollyCamera;

  // The window in points; the take is a 2x capture of it.
  const WIN_W = 1600;
  const WIN_H = 900;
  const SOURCE = [WIN_W * 2, WIN_H * 2];

  const TITLE_H = 52;
  const SIDEBAR_W = 260;
  const COL_X = [306, 740, 1174];
  const COL_W = 396;
  const COL_TOP = 132;
  const CARD_TOP = 190;
  const CARD_H = 92;
  const CARD_STEP = 106;

  const PALETTE = {
    window: "#FBFAF7",
    title: "#EEEAE3",
    sidebar: "#F3F0EA",
    column: "#F1EEE8",
    card: "#FFFFFF",
    line: "#E2DDD4",
    ink: "#2A2733",
    muted: "#8C8796",
    faint: "#BDB7C4",
    accent: "#FF7A45",
    blue: "#4C7DFF",
    green: "#2FB37A",
    violet: "#8B6CF6",
    pad: "#14121C",
  };

  const COLUMNS = [
    { title: "Backlog", cards: [["Dark mode polish", "violet", 0.2], ["Export presets", "blue", 0], ["Crash on resize", "accent", 0.1]] },
    { title: "Doing", cards: [["Ship onboarding", "accent", 0.6], ["Shot file schema", "blue", 0.35]] },
    { title: "Done", cards: [["Spline camera", "green", 1], ["Window resize", "green", 1]] },
  ];
  const SIDEBAR = ["Inbox", "Today", "Roadmap", "Releases", "Archive"];

  const cardCenter = (col, row) => [COL_X[col] + COL_W / 2, CARD_TOP + row * CARD_STEP + CARD_H / 2];
  const CARD_A = cardCenter(1, 0);
  const DROP = cardCenter(2, 2);
  const REST = [840, 650];
  const AWAY = [1240, 730];

  // Window-normalised rects, for shot files.
  const RECTS = {
    card: [COL_X[1] / WIN_W, CARD_TOP / WIN_H, COL_W / WIN_W, CARD_H / WIN_H],
    drop: [COL_X[2] / WIN_W, (CARD_TOP + 2 * CARD_STEP) / WIN_H, COL_W / WIN_W, CARD_H / WIN_H],
    sidebar: [0, TITLE_H / WIN_H, SIDEBAR_W / WIN_W, 300 / WIN_H],
    backlog: [COL_X[0] / WIN_W, COL_TOP / WIN_H, COL_W / WIN_W, 340 / WIN_H],
    toolbar: [(WIN_W - 140) / WIN_W, 10 / WIN_H, 110 / WIN_W, 32 / WIN_H],
  };
  const norm = (p) => [Math.round((p[0] / WIN_W) * 1000) / 1000, Math.round((p[1] / WIN_H) * 1000) / 1000];
  // Window-normalised points, for shot files.
  const POINTS = {
    card: norm(CARD_A),
    drop: norm(DROP),
    sidebar: norm([SIDEBAR_W / 2, 112 + 2 * 44 + 18]),
    backlog: norm([COL_X[0] + COL_W / 2, CARD_TOP + CARD_STEP]),
    done: norm(cardCenter(2, 0)),
    toolbar: norm([WIN_W - 85, 26]),
  };

  // MARK: - The take

  const TAKE = {
    length: 10,
    travelIn: [0.7, 1.8],
    hoverAt: 1.8,
    pressAt: 3.2,
    drag: [3.4, 4.9],
    releaseAt: 5.5,
    settle: [5.5, 5.9],
    travelOut: [6.4, 7.4],
    // What an agent types to produce the take, at the moment it runs.
    commands: [
      { at: 0.1, cmd: "dolly front", out: '{"command":"front","name":"Acme","ok":true,"pid":4711}' },
      { at: 0.7, cmd: `dolly hover ${CARD_A[0]},${CARD_A[1]} --guard 4711 --hold 1.2`, out: '{"command":"hover","held":1.2,"ms":1100,"ok":true}' },
      { at: 3.2, cmd: `dolly drag ${CARD_A[0]},${CARD_A[1]} ${DROP[0]},${DROP[1]} --guard 4711 --ms 1500 --hold 0.6`, out: '{"command":"drag","held":0.6,"ms":1500,"ok":true}' },
      { at: 6.4, cmd: `dolly move ${AWAY[0]},${AWAY[1]} --guard 4711`, out: '{"command":"move","ms":1000,"ok":true}' },
    ],
  };

  // The camera written over that take, as a shot file's beats.
  const HERO_BEATS = [
    { move: "hold", for: 0.6 },
    { move: "focus", at: 1.9, point: POINTS.card, zoom: 1.5, for: 1.6 },
    { move: "pan-to", at: 3.6, point: POINTS.drop, for: 1.6 },
    { move: "punch-in", at: 5.5, amount: 1.1 },
    { move: "pull-back", at: 7.2, for: 1.8 },
  ];

  const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
  const span = (t, [a, b]) => clamp01((t - a) / (b - a));
  const lerp = (a, b, u) => a + (b - a) * u;
  const lerp2 = (p, q, u) => [lerp(p[0], q[0], u), lerp(p[1], q[1], u)];
  const ease = POINTER_EASES.inOut;

  function takeState(t) {
    let pointer;
    if (t < TAKE.travelIn[1]) pointer = lerp2(REST, CARD_A, ease(span(t, TAKE.travelIn)));
    else if (t < TAKE.drag[0]) pointer = CARD_A;
    else if (t < TAKE.travelOut[0]) pointer = lerp2(CARD_A, DROP, ease(span(t, TAKE.drag)));
    else pointer = lerp2(DROP, AWAY, ease(span(t, TAKE.travelOut)));

    const pressed = t >= TAKE.pressAt && t < TAKE.releaseAt;
    const dragging = t >= TAKE.pressAt && t < TAKE.settle[1];
    let card = null;
    if (dragging) {
      // The card rides with the pointer, lifted, then settles into its slot.
      const lift = Math.min(1, (t - TAKE.pressAt) / 0.2);
      const settle = ease(span(t, TAKE.settle));
      card = { center: pointer, lift: lift * (1 - settle), slot: settle };
    }
    return {
      pointer,
      pressed,
      card,
      moved: t >= TAKE.settle[1],
      hover: t >= TAKE.hoverAt && t < TAKE.pressAt ? clamp01((t - TAKE.hoverAt) / 0.15) : 0,
      tooltip: t >= TAKE.hoverAt + 0.35 && t < TAKE.pressAt ? clamp01((t - TAKE.hoverAt - 0.35) / 0.2) : 0,
      dropOverlay: dragging && t < TAKE.releaseAt && pointer[0] > COL_X[2] - 20 ? clamp01((pointer[0] - COL_X[2] + 20) / 120) : 0,
      collapse: ease(span(t, [TAKE.drag[0], TAKE.drag[0] + 0.4])),
      toast: t >= TAKE.releaseAt + 0.2 && t < 8.8 ? Math.min(clamp01((t - TAKE.releaseAt - 0.2) / 0.25), clamp01((8.8 - t) / 0.3)) : 0,
    };
  }

  // MARK: - Drawing

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", sans-serif';

  function text(ctx, s, x, y, size, color, weight = 500, align = "left") {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "middle";
    ctx.fillText(s, x, y);
  }

  function drawCard(ctx, x, y, [title, tag, progress], opts = {}) {
    ctx.save();
    if (opts.lift) {
      ctx.translate(x + COL_W / 2, y + CARD_H / 2);
      ctx.rotate(-0.035 * opts.lift);
      ctx.scale(1 + 0.03 * opts.lift, 1 + 0.03 * opts.lift);
      ctx.translate(-(x + COL_W / 2), -(y + CARD_H / 2));
      ctx.shadowColor = "rgba(30,27,46,0.22)";
      ctx.shadowBlur = 30 * opts.lift;
      ctx.shadowOffsetY = 14 * opts.lift;
    } else {
      ctx.shadowColor = "rgba(30,27,46,0.06)";
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1;
    }
    rr(ctx, x, y, COL_W, CARD_H, 12);
    ctx.fillStyle = PALETTE.card;
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = opts.hover ? 2 : 1;
    ctx.strokeStyle = opts.hover ? `rgba(255,122,69,${0.35 + 0.65 * opts.hover})` : PALETTE.line;
    ctx.stroke();
    if (opts.hover) {
      rr(ctx, x, y, COL_W, CARD_H, 12);
      ctx.fillStyle = `rgba(255,122,69,${0.06 * opts.hover})`;
      ctx.fill();
    }
    ctx.fillStyle = PALETTE[tag];
    rr(ctx, x + 18, y + 18, 6, 22, 3);
    ctx.fill();
    text(ctx, title, x + 36, y + 29, 18, PALETTE.ink, 600);
    // progress
    rr(ctx, x + 18, y + 62, 200, 6, 3);
    ctx.fillStyle = PALETTE.column;
    ctx.fill();
    if (progress > 0) {
      rr(ctx, x + 18, y + 62, Math.max(6, 200 * progress), 6, 3);
      ctx.fillStyle = PALETTE[tag];
      ctx.fill();
    }
    // avatars
    const people = ["#FFB18F", "#A9C1FF", "#9EDFC2"];
    for (let i = 0; i < 2 + (title.length % 2); i++) {
      ctx.beginPath();
      ctx.arc(x + COL_W - 30 - i * 18, y + 64, 11, 0, Math.PI * 2);
      ctx.fillStyle = people[i];
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = PALETTE.card;
      ctx.stroke();
    }
    ctx.restore();
  }

  // The pointer is the brand mark's cursor.
  const CURSOR = new Path2D("M33 20.7 L33 72.5 L46.7 59.7 L56.2 80.4 L64.7 76.8 L55.5 56.7 L72.6 55.7 Z");

  function drawPointer(ctx, [x, y], pressed) {
    ctx.save();
    ctx.translate(x, y);
    const s = 0.44 * (pressed ? 0.9 : 1);
    ctx.scale(s, s);
    ctx.translate(-33, -20.7);
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.lineJoin = "round";
    ctx.lineWidth = 9;
    ctx.strokeStyle = "#1E1B2E";
    ctx.stroke(CURSOR);
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#FFF8EE";
    ctx.fill(CURSOR);
    ctx.restore();
  }

  function drawWindow(ctx, t) {
    const s = takeState(t);
    ctx.save();
    // frame
    ctx.fillStyle = PALETTE.window;
    ctx.fillRect(0, 0, WIN_W, WIN_H);
    // title bar
    ctx.fillStyle = PALETTE.title;
    ctx.fillRect(0, 0, WIN_W, TITLE_H);
    ctx.fillStyle = PALETTE.line;
    ctx.fillRect(0, TITLE_H - 1, WIN_W, 1);
    ["#FF5F57", "#FEBC2E", "#28C840"].forEach((c, i) => {
      ctx.beginPath();
      ctx.arc(24 + i * 22, TITLE_H / 2, 7, 0, Math.PI * 2);
      ctx.fillStyle = c;
      ctx.fill();
    });
    text(ctx, "Roadmap — Acme", WIN_W / 2, TITLE_H / 2, 16, PALETTE.ink, 600, "center");
    rr(ctx, WIN_W - 140, 10, 110, 32, 8);
    ctx.fillStyle = PALETTE.accent;
    ctx.fill();
    text(ctx, "+  New", WIN_W - 85, 26, 15, "#fff", 600, "center");

    // sidebar
    ctx.fillStyle = PALETTE.sidebar;
    ctx.fillRect(0, TITLE_H, SIDEBAR_W, WIN_H - TITLE_H);
    ctx.fillStyle = PALETTE.line;
    ctx.fillRect(SIDEBAR_W - 1, TITLE_H, 1, WIN_H - TITLE_H);
    text(ctx, "WORKSPACE", 24, 88, 12, PALETTE.muted, 700);
    SIDEBAR.forEach((label, i) => {
      const y = 112 + i * 44;
      if (i === 2) {
        rr(ctx, 12, y, SIDEBAR_W - 24, 36, 8);
        ctx.fillStyle = "rgba(255,122,69,0.14)";
        ctx.fill();
      }
      rr(ctx, 26, y + 11, 14, 14, 4);
      ctx.fillStyle = i === 2 ? PALETTE.accent : PALETTE.faint;
      ctx.fill();
      text(ctx, label, 52, y + 18, 16, i === 2 ? PALETTE.ink : PALETTE.muted, i === 2 ? 600 : 500);
    });

    // board
    text(ctx, "Roadmap", COL_X[0], 92, 26, PALETTE.ink, 700);
    text(ctx, "Q4 · 7 cards", COL_X[0] + 124, 94, 15, PALETTE.muted, 500);
    COLUMNS.forEach((col, ci) => {
      const x = COL_X[ci];
      rr(ctx, x - 10, COL_TOP, COL_W + 20, WIN_H - COL_TOP - 24, 14);
      ctx.fillStyle = PALETTE.column;
      ctx.fill();
      let count = col.cards.length;
      if (ci === 1 && s.card) count -= 1;
      if (ci === 1 && s.moved) count -= 1;
      if (ci === 2 && (s.moved || (s.card && s.card.slot > 0.5))) count += 1;
      text(ctx, col.title, x + 6, COL_TOP + 30, 16, PALETTE.ink, 700);
      text(ctx, String(count), x + 6 + col.title.length * 9.6 + 12, COL_TOP + 30, 14, PALETTE.muted, 600);

      if (ci === 2 && s.dropOverlay > 0) {
        rr(ctx, x - 4, CARD_TOP + 2 * CARD_STEP - 6, COL_W + 8, CARD_H + 12, 14);
        ctx.fillStyle = `rgba(255,122,69,${0.1 * s.dropOverlay})`;
        ctx.fill();
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = `rgba(255,122,69,${0.9 * s.dropOverlay})`;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      col.cards.forEach((card, ri) => {
        const isA = ci === 1 && ri === 0;
        if (isA && (s.card || s.moved)) return;
        let y = CARD_TOP + ri * CARD_STEP;
        if (ci === 1 && ri > 0 && (s.card || s.moved)) y -= CARD_STEP * (s.moved ? 1 : s.collapse);
        drawCard(ctx, x, y, card, { hover: isA ? s.hover : 0 });
      });
      if (ci === 2 && s.moved) drawCard(ctx, x, CARD_TOP + 2 * CARD_STEP, COLUMNS[1].cards[0]);
    });

    // the dragged card, between the pointer and its slot
    if (s.card) {
      const target = [DROP[0], DROP[1]];
      const c = lerp2(s.card.center, target, s.card.slot);
      const grip = 1 - s.card.slot;
      drawCard(ctx, c[0] - COL_W / 2 + 14 * grip, c[1] - CARD_H / 2 + 10 * grip, COLUMNS[1].cards[0], { lift: s.card.lift });
    }

    // tooltip
    if (s.tooltip > 0) {
      ctx.save();
      ctx.globalAlpha = s.tooltip;
      const tx = CARD_A[0] + 18;
      const ty = CARD_A[1] + 44 + 8 * (1 - s.tooltip);
      rr(ctx, tx, ty, 186, 40, 9);
      ctx.fillStyle = "#1E1B2E";
      ctx.fill();
      text(ctx, "Due Fri · 3 of 5 tasks", tx + 93, ty + 20, 14, "#FFF8EE", 600, "center");
      ctx.restore();
    }

    // toast
    if (s.toast > 0) {
      ctx.save();
      ctx.globalAlpha = s.toast;
      const w = 260;
      const x = COL_X[2] + COL_W / 2 - w / 2;
      const y = WIN_H - 92 + 12 * (1 - s.toast);
      rr(ctx, x, y, w, 46, 12);
      ctx.fillStyle = "#1E1B2E";
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 26, y + 23, 9, 0, Math.PI * 2);
      ctx.fillStyle = PALETTE.green;
      ctx.fill();
      text(ctx, "Moved to Done", x + 46, y + 23, 15, "#FFF8EE", 600);
      ctx.restore();
    }

    drawPointer(ctx, s.pointer, s.pressed);
    ctx.restore();
  }

  // The camera's visible rect on the canvas, in source pixels.
  function viewRect(camera, t) {
    const [z, cx, cy] = camera.view(t);
    const [canW, canH] = camera.canvas;
    const w = canW / z;
    const h = canH / z;
    return { x: cx * canW - w / 2, y: cy * canH - h / 2, w, h, z };
  }

  // Draw the canvas (pad + window) with source-pixel rect `r` filling (dx, dy, dw, dh).
  function drawCanvasRect(ctx, camera, r, dx, dy, dw, dh, t, windowTime = t) {
    const [canW, canH, offX, offY] = camera.canvas;
    const s = dw / r.w;
    ctx.save();
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.clip();
    ctx.fillStyle = PALETTE.pad;
    ctx.fillRect(dx, dy, dw, dh);
    ctx.translate(dx - r.x * s, dy - r.y * s);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.rect(0, 0, canW, canH);
    ctx.clip();
    ctx.translate(offX, offY);
    ctx.scale(SOURCE[0] / WIN_W, SOURCE[1] / WIN_H);
    drawWindow(ctx, windowTime);
    ctx.restore();
  }

  // What the camera renders: the output frame at time t.
  function drawFilm(ctx, camera, t, dx, dy, dw, dh, windowTime) {
    drawCanvasRect(ctx, camera, viewRect(camera, t), dx, dy, dw, dh, t, windowTime);
  }

  // The whole canvas with the camera's frame drawn over it.
  function drawOverview(ctx, camera, t, dx, dy, dw, dh, opts = {}) {
    const [canW, canH] = camera.canvas;
    drawCanvasRect(ctx, camera, { x: 0, y: 0, w: canW, h: canH }, dx, dy, dw, dh, t, opts.windowTime);
    const r = viewRect(camera, t);
    const s = dw / canW;
    const vx = dx + r.x * s;
    const vy = dy + r.y * s;
    const vw = r.w * s;
    const vh = r.h * s;
    ctx.save();
    // dim what the camera leaves out
    ctx.fillStyle = "rgba(20,18,28,0.42)";
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.rect(vx, vy, vw, vh);
    ctx.fill("evenodd");
    // the path of the frame's centre so far
    if (opts.trail) {
      ctx.beginPath();
      const from = Math.max(0, t - opts.trail);
      for (let u = from; u <= t; u += 1 / 30) {
        const q = viewRect(camera, u);
        const px = dx + (q.x + q.w / 2) * s;
        const py = dy + (q.y + q.h / 2) * s;
        if (u === from) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.strokeStyle = "rgba(255,122,69,0.75)";
      ctx.lineWidth = Math.max(1.5, dw / 400);
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const lw = Math.max(2, dw / 260);
    ctx.lineWidth = lw;
    ctx.strokeStyle = PALETTE.accent;
    ctx.strokeRect(vx, vy, vw, vh);
    // viewfinder corners
    const c = Math.min(vw, vh) * 0.12;
    ctx.lineWidth = lw * 1.8;
    ctx.beginPath();
    [[vx, vy, 1, 1], [vx + vw, vy, -1, 1], [vx, vy + vh, 1, -1], [vx + vw, vy + vh, -1, -1]].forEach(([x, y, sx, sy]) => {
      ctx.moveTo(x + sx * c, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * c);
    });
    ctx.stroke();
    if (opts.label !== false) {
      // the zoom, tucked inside the frame's bottom-right corner
      const label = `${r.z.toFixed(2)}×`;
      const size = Math.max(10, Math.min(13, dw / 48));
      ctx.font = `700 ${size}px ui-monospace, "SF Mono", Menlo, monospace`;
      const tw = ctx.measureText(label).width;
      const lh = size * 1.6;
      const lx = Math.min(vx + vw, dx + dw) - tw - 10 - lw;
      const ly = Math.min(vy + vh, dy + dh) - lh - lw;
      ctx.fillStyle = PALETTE.accent;
      ctx.fillRect(lx, ly, tw + 10, lh);
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(label, lx + 5, ly + lh / 2 + 1);
    }
    ctx.restore();
  }

  global.DollyApp = {
    WIN_W, WIN_H, SOURCE, RECTS, POINTS, TAKE, HERO_BEATS, PALETTE, CARD_A, DROP,
    norm, takeState, drawWindow, drawFilm, drawOverview, drawPointer, viewRect, rr,
  };
})(window);
