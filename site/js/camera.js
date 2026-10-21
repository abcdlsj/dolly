// A browser port of the camera in scripts/camera.py: the same eases, monotone
// spline, canvas padding, ceiling and named moves, so what the page shows is
// what `camera.py --shot` would render.
(function (global) {
  "use strict";

  const SHORT_SIDE = 1080;
  const SAMPLE_RATE = 60;

  // Each ease maps segment progress u in 0..1 onto c0 + c1 u + c2 u² + c3 u³.
  const BACK = 1.70158;
  const EASES = {
    smooth: [0, 0, 3, -2],
    linear: [0, 1, 0, 0],
    in: [0, 0, 0, 1],
    out: [0, 3, -3, 1],
    back: [0, 3 * (BACK + 1) - 2 * BACK, BACK - 3 * (BACK + 1), BACK + 1],
  };

  const DEFAULT_LENGTH = {
    hold: 0.5, focus: 1.8, frame: 1.6, "pull-back": 1.6, "pan-to": 1.4, "punch-in": 0.35,
  };

  function key(t, zoom, x, y, ease) {
    return { t, zoom, x: x == null ? 0.5 : x, y: y == null ? 0.5 : y, ease: ease || "spline" };
  }

  function aspectSize(text) {
    const [across, down] = text.split(":").map(Number);
    if (across >= down) return [Math.round((SHORT_SIDE * across) / down / 2) * 2, SHORT_SIDE];
    return [SHORT_SIDE, Math.round((SHORT_SIDE * down) / across / 2) * 2];
  }

  // The output-aspect canvas a window is brought into, and where it sits on it.
  function canvasFor(source, fit, out) {
    const [srcW, srcH] = source;
    const [outW, outH] = out;
    let width, height;
    if (fit === "pad") {
      width = Math.max(srcW, (srcH * outW) / outH);
      height = Math.max(srcH, (srcW * outH) / outW);
    } else {
      width = Math.min(srcW, (srcH * outW) / outH);
      height = Math.min(srcH, (srcW * outH) / outW);
    }
    width = Math.round(width / 2) * 2;
    height = Math.round(height / 2) * 2;
    return [width, height, Math.floor((width - srcW) / 2), Math.floor((height - srcH) / 2)];
  }

  function ceilingFor(source, fit, out) {
    return Math.round(Math.max(canvasFor(source, fit, out)[0] / out[0], 1) * 1000) / 1000;
  }

  // Monotone (PCHIP) slopes, zero at the ends and wherever the camera holds or turns.
  function tangents(times, values, eases) {
    const slopes = new Array(times.length).fill(0);
    for (let i = 1; i < times.length - 1; i++) {
      if (eases[i] !== "spline" || eases[i + 1] !== "spline") continue;
      const h0 = times[i] - times[i - 1];
      const h1 = times[i + 1] - times[i];
      if (h0 <= 0 || h1 <= 0) continue;
      const d0 = (values[i] - values[i - 1]) / h0;
      const d1 = (values[i + 1] - values[i]) / h1;
      if (d0 * d1 <= 0) continue;
      const w0 = 2 * h1 + h0;
      const w1 = h1 + 2 * h0;
      slopes[i] = (w0 + w1) / (w0 / d0 + w1 / d1);
    }
    return slopes;
  }

  function channel(times, values, eases) {
    const slopes = tangents(times, values, eases);
    const segments = [];
    for (let i = 0; i < times.length - 1; i++) {
      const t0 = times[i];
      const t1 = times[i + 1];
      const a = values[i];
      const b = values[i + 1];
      const ease = eases[i + 1];
      let c;
      if (ease === "spline") {
        const h = t1 - t0;
        const m0 = slopes[i] * h;
        const m1 = slopes[i + 1] * h;
        c = [a, m0, -3 * a - 2 * m0 + 3 * b - m1, 2 * a + m0 - 2 * b + m1];
      } else {
        const f = EASES[ease];
        c = [a + (b - a) * f[0], (b - a) * f[1], (b - a) * f[2], (b - a) * f[3]];
      }
      segments.push({ start: t0, end: t1, c });
    }
    const evaluate = (s, t) => {
      const u = Math.min(Math.max((t - s.start) / Math.max(s.end - s.start, 1e-6), 0), 1);
      return s.c[0] + u * (s.c[1] + u * (s.c[2] + u * s.c[3]));
    };
    return {
      at(t) {
        if (!segments.length || t <= segments[0].start) return values[0];
        for (const s of segments) if (t < s.end) return evaluate(s, t);
        const last = segments[segments.length - 1];
        return evaluate(last, last.end);
      },
    };
  }

  // The camera path of one shot, on the canvas the graph pans over.
  function buildCamera(keys, source, fit, ceiling, out) {
    const [srcW, srcH] = source;
    const [canW, canH, offX, offY] = canvasFor(source, fit, out);
    const times = keys.map((k) => k.t);
    const eases = keys.map((k) => k.ease);
    const clamp01 = (v) => Math.min(Math.max(v, 0), 1);
    const zoom = channel(times, keys.map((k) => Math.log(Math.min(Math.max(k.zoom, 1), ceiling))), eases);
    const x = channel(times, keys.map((k) => (clamp01(k.x) * srcW + offX) / canW), eases);
    const y = channel(times, keys.map((k) => (clamp01(k.y) * srcH + offY) / canH), eases);
    return {
      source, fit, out, ceiling,
      canvas: [canW, canH, offX, offY],
      // Zoom and the centre of the visible window, canvas-normalised, as rendered.
      view(t) {
        const z = Math.min(Math.max(Math.exp(zoom.at(t)), 1), ceiling);
        const half = 0.5 / z;
        return [
          z,
          Math.min(Math.max(x.at(t), half), 1 - half),
          Math.min(Math.max(y.at(t), half), 1 - half),
        ];
      },
    };
  }

  function pointOf(beat) {
    if (beat.rect) return [beat.rect[0] + beat.rect[2] / 2, beat.rect[1] + beat.rect[3] / 2];
    if (beat.point) return [beat.point[0], beat.point[1]];
    return null;
  }

  function fitZoom(rect, fill, source, fit, out) {
    const [canW, canH] = canvasFor(source, fit, out);
    const width = Math.max(rect[2] * source[0], 1);
    const height = Math.max(rect[3] * source[1], 1);
    return fill * Math.min(canW / width, canH / height);
  }

  function resolveTime(value, previousEnd, length) {
    if (value == null) return previousEnd;
    if (typeof value === "number") return value;
    const text = String(value).trim();
    if (text.startsWith("+")) return previousEnd + Number(text.slice(1));
    if (text.startsWith("end")) {
      const rest = text.slice(3).trim();
      return length + (rest ? Number(rest) : 0);
    }
    return Number(text);
  }

  // Expand named moves into keyframes, starting on the whole window.
  function planShot(beatsIn, source, fit, ceiling, out, length) {
    let zoom = 1;
    let x = 0.5;
    let y = 0.5;
    const keys = [key(0, zoom, x, y)];
    const beats = [];
    const warnings = [];
    const clampZoom = (z) => Math.min(Math.max(z, 1), ceiling);
    const place = (t, z, px, py, ease) => {
      const last = keys[keys.length - 1];
      if (t - last.t < 1e-6) keys[keys.length - 1] = key(last.t, z, px, py, last.ease);
      else keys.push(key(t, z, px, py, ease));
    };

    beatsIn.forEach((beat, index) => {
      const move = beat.move;
      const start = resolveTime(beat.at, keys[keys.length - 1].t, length);
      place(start, zoom, x, y, "spline");

      let duration;
      if (move === "drift") {
        const following = index + 1 < beatsIn.length ? beatsIn[index + 1].at : null;
        const end = following != null ? resolveTime(following, start, length) : length != null ? length : start + 3;
        duration = beat.for != null ? beat.for : end - start;
      } else if (move === "tour") {
        duration = 0;
      } else {
        duration = beat.for != null ? beat.for : DEFAULT_LENGTH[move];
      }
      const ease = beat.ease;
      let requested = null;

      if (move === "hold") {
        place(start + duration, zoom, x, y, "spline");
      } else if (move === "focus" || move === "frame") {
        if (beat.zoom != null) requested = beat.zoom;
        else if (beat.rect) requested = fitZoom(beat.rect, beat.fill != null ? beat.fill : 0.5, source, fit, out);
        else requested = 1.28;
        zoom = clampZoom(requested);
        [x, y] = pointOf(beat);
        place(start + duration, zoom, x, y, ease || "spline");
      } else if (move === "pull-back") {
        zoom = 1; x = 0.5; y = 0.5;
        place(start + duration, zoom, x, y, ease || "spline");
      } else if (move === "pan-to") {
        [x, y] = pointOf(beat);
        place(start + duration, zoom, x, y, ease || "spline");
      } else if (move === "punch-in") {
        requested = zoom * (beat.amount != null ? beat.amount : 1.12);
        zoom = clampZoom(requested);
        const target = pointOf(beat);
        if (target) [x, y] = target;
        place(start + duration, zoom, x, y, ease || "back");
      } else if (move === "drift") {
        requested = zoom * (beat.amount != null ? beat.amount : 1.04);
        zoom = clampZoom(requested);
        place(start + duration, zoom, x, y, ease || "linear");
      } else if (move === "tour") {
        const travel = beat.travel != null ? beat.travel : 1.2;
        const hold = beat.hold != null ? beat.hold : 0.8;
        if (beat.zoom != null) {
          requested = beat.zoom;
          zoom = clampZoom(requested);
        }
        let t = start;
        for (const stop of beat.stops) {
          [x, y] = pointOf(Array.isArray(stop) ? { point: stop } : stop);
          t += travel;
          place(t, zoom, x, y, ease || "spline");
          if (hold > 0) {
            t += hold;
            place(t, zoom, x, y, "spline");
          }
        }
        duration = t - start;
      }

      const clamped = requested != null && requested > ceiling + 1e-6;
      if (clamped) {
        warnings.push(`beat ${index} (${move}) asks for zoom ${requested.toFixed(3)}; clamped to the ceiling ${ceiling.toFixed(3)}`);
      }
      beats.push({ move, start, end: start + duration, clamped });
    });

    return { keys, beats, warnings };
  }

  // Peak speeds and the SKILL.md rules, as `--explain` reports them.
  function review(camera, keys, beats, length) {
    const warnings = [];
    const end = Math.max(length || 0, keys[keys.length - 1].t);
    const steps = Math.max(Math.floor(end * SAMPLE_RATE), 1);
    let pan = 0;
    let zoomRate = 0;
    let first = null;
    let last = null;
    let prev = camera.view(0);
    for (let i = 1; i <= steps; i++) {
      const v = camera.view(i / SAMPLE_RATE);
      const dx = (v[1] - prev[1]) * v[0];
      const dy = ((v[2] - prev[2]) * v[0] * camera.out[1]) / camera.out[0];
      const speed = Math.hypot(dx, dy) * SAMPLE_RATE;
      const rate = Math.abs(Math.log(v[0] / prev[0])) * SAMPLE_RATE;
      pan = Math.max(pan, speed);
      zoomRate = Math.max(zoomRate, rate);
      if (speed > 1e-3 || rate > 1e-3) {
        if (first == null) first = i / SAMPLE_RATE;
        last = i / SAMPLE_RATE;
      }
      prev = v;
    }
    if (first != null && first < 0.3) warnings.push(`camera moves at ${first.toFixed(2)}s; hold 0.3–0.6 s before the first move`);
    if (last != null && length != null && length - last < 0.3) {
      warnings.push(`camera still moving at ${last.toFixed(2)}s of ${length.toFixed(2)}s; leave 0.3 s still at the end`);
    }
    if (pan > 0.8) warnings.push(`pan peaks at ${pan.toFixed(2)} frame widths/s; above ~0.8 it reads as a blur`);
    if (zoomRate > 0.6 && !beats.some((b) => b.move === "punch-in")) {
      warnings.push(`zoom changes ${zoomRate.toFixed(2)}x/s at its peak; slow it down or use punch-in on purpose`);
    }
    if (length != null && keys[keys.length - 1].t > length + 1e-6) {
      warnings.push(`last keyframe at ${keys[keys.length - 1].t.toFixed(2)}s is past the end of the take (${length.toFixed(2)}s)`);
    }
    const moves = beats.filter((b) => b.move !== "hold");
    for (let i = 1; i < moves.length; i++) {
      const a = moves[i - 1];
      const b = moves[i];
      if (b.start - a.start < 1.5 && a.move !== "punch-in" && b.move !== "punch-in") {
        warnings.push(`${a.move} at ${a.start.toFixed(2)}s and ${b.move} at ${b.start.toFixed(2)}s are under 1.5 s apart`);
      }
    }
    return { peak_pan: Math.round(pan * 1000) / 1000, peak_zoom_rate: Math.round(zoomRate * 1000) / 1000, warnings };
  }

  // A whole shot: plan, camera and review in one call.
  function shot({ beats, source, aspect = "16:9", fit = "pad", length = null }) {
    const out = aspectSize(aspect);
    const ceiling = ceilingFor(source, fit, out);
    const plan = planShot(beats, source, fit, ceiling, out, length);
    const upscaled = canvasFor(source, fit, out)[0] < out[0];
    const warnings = plan.warnings.slice();
    if (upscaled) warnings.push(`the canvas is narrower than ${out[0]} px; text will be soft at any zoom`);
    const camera = buildCamera(plan.keys, source, fit, ceiling, out);
    const report = review(camera, plan.keys, plan.beats, length);
    const round3 = (v) => Math.round(v * 1000) / 1000;
    return {
      camera, ceiling, out, fit, upscaled, keys: plan.keys, beats: plan.beats,
      length: length != null ? length : plan.keys[plan.keys.length - 1].t,
      warnings: warnings.concat(report.warnings),
      peak_pan: report.peak_pan,
      peak_zoom_rate: report.peak_zoom_rate,
      // What `camera.py --shot … --explain` prints for the same shot.
      explain() {
        const f = (v) => v.toFixed(3);
        return {
          ok: true, source, output: out, fit, ceiling, upscaled,
          length: length != null ? round3(length) : null,
          keys: plan.keys.map((k) => `${f(k.t)}:${f(Math.min(Math.max(k.zoom, 1), ceiling))}:${f(k.x)}:${f(k.y)}:${k.ease}`),
          beats: plan.beats.map((b) => ({ move: b.move, start: round3(b.start), end: round3(b.end), clamped: b.clamped })),
          peak_pan: report.peak_pan,
          peak_zoom_rate: report.peak_zoom_rate,
          warnings: this.warnings,
        };
      },
    };
  }

  // dolly's own pointer eases (Sources/dolly/Input.swift).
  const POINTER_EASES = {
    linear: (t) => t,
    inOut: (t) => t * t * (3 - 2 * t),
    out: (t) => 1 - (1 - t) ** 3,
    inQuint: (t) => t ** 5,
  };

  global.DollyCamera = { EASES, POINTER_EASES, aspectSize, canvasFor, ceilingFor, shot };
})(window);
