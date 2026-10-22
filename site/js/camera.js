(() => {
  // packages/core/src/eases.ts
  var BACK = 1.70158;
  var CAMERA_EASES = {
    smooth: [0, 0, 3, -2],
    linear: [0, 1, 0, 0],
    in: [0, 0, 0, 1],
    out: [0, 3, -3, 1],
    back: [0, 3 * (BACK + 1) - 2 * BACK, BACK - 3 * (BACK + 1), BACK + 1]
  };
  var CAMERA_EASE_NAMES = ["spline", ...Object.keys(CAMERA_EASES)];
  function isCameraEase(name) {
    return typeof name === "string" && CAMERA_EASE_NAMES.includes(name);
  }
  var POINTER_EASES = {
    linear: (t) => t,
    inOut: (t) => t * t * (3 - 2 * t),
    out: (t) => 1 - (1 - t) ** 3,
    inQuint: (t) => t ** 5
  };
  // packages/core/src/geometry.ts
  var SHORT_SIDE = 1080;
  var HD = [1920, 1080];

  class UsageError extends Error {
  }
  function parseAspect(text) {
    const parts = text.split(":").map(Number);
    const [across, down] = parts;
    if (parts.length !== 2 || across === undefined || down === undefined || Number.isNaN(across) || Number.isNaN(down)) {
      throw new UsageError(`bad aspect ${JSON.stringify(text)}, want w:h such as 16:9`);
    }
    if (across <= 0 || down <= 0)
      throw new UsageError(`bad aspect ${JSON.stringify(text)}`);
    if (across >= down)
      return [Math.round(SHORT_SIDE * across / down / 2) * 2, SHORT_SIDE];
    return [SHORT_SIDE, Math.round(SHORT_SIDE * down / across / 2) * 2];
  }
  function canvas(source, fit, out = HD) {
    const [srcW, srcH] = source;
    const [outW, outH] = out;
    const pick = fit === "pad" ? Math.max : Math.min;
    const width = Math.round(pick(srcW, srcH * outW / outH) / 2) * 2;
    const height = Math.round(pick(srcH, srcW * outH / outW) / 2) * 2;
    return [width, height, Math.floor((width - srcW) / 2), Math.floor((height - srcH) / 2)];
  }
  function ceilingFor(source, fit, out = HD) {
    return round3(Math.max(canvas(source, fit, out)[0] / out[0], 1));
  }
  function round3(value) {
    return Math.round(value * 1000) / 1000;
  }
  function clamp(value, low, high) {
    return Math.min(Math.max(value, low), high);
  }
  // packages/core/src/channel.ts
  class Segment {
    start;
    end;
    coefficients;
    constructor(start, end, coefficients) {
      this.start = start;
      this.end = end;
      this.coefficients = coefficients;
    }
    at(t) {
      const u = clamp((t - this.start) / Math.max(this.end - this.start, 0.000001), 0, 1);
      const [c0, c1, c2, c3] = this.coefficients;
      return c0 + u * (c1 + u * (c2 + u * c3));
    }
  }

  class Channel {
    first;
    segments;
    constructor(first, segments) {
      this.first = first;
      this.segments = segments;
    }
    static build(times, values, eases) {
      const slopes = tangents(times, values, eases);
      const segments = [];
      for (let i = 0;i < times.length - 1; i++) {
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
          const f = CAMERA_EASES[ease];
          c = [a + (b - a) * f[0], (b - a) * f[1], (b - a) * f[2], (b - a) * f[3]];
        }
        segments.push(new Segment(t0, t1, c));
      }
      return new Channel(values[0], segments);
    }
    at(t) {
      const first = this.segments[0];
      if (!first || t <= first.start)
        return this.first;
      for (const segment of this.segments)
        if (t < segment.end)
          return segment.at(t);
      const last = this.segments[this.segments.length - 1];
      return last.at(last.end);
    }
    expression(clock = "t") {
      const last = this.segments[this.segments.length - 1];
      if (!last)
        return fixed(this.first, 6);
      let expression = fixed(last.at(last.end), 6);
      for (const segment of [...this.segments].reverse()) {
        const span = Math.max(segment.end - segment.start, 0.000001);
        const u = `clip((${clock}-${segment.start.toFixed(4)})/${span.toFixed(4)},0,1)`;
        const [c0, c1, c2, c3] = segment.coefficients.map((c) => fixed(c, 6));
        const cubic = `(${c0}+${u}*(${c1}+${u}*(${c2}+${u}*${c3})))`;
        expression = `if(lt(${clock},${segment.end.toFixed(4)}),${cubic},${expression})`;
      }
      return expression;
    }
  }
  function fixed(value, digits) {
    return Object.is(value, -0) ? `-${0 .toFixed(digits)}` : value.toFixed(digits);
  }
  function tangents(times, values, eases) {
    const slopes = new Array(times.length).fill(0);
    for (let i = 1;i < times.length - 1; i++) {
      if (eases[i] !== "spline" || eases[i + 1] !== "spline")
        continue;
      const h0 = times[i] - times[i - 1];
      const h1 = times[i + 1] - times[i];
      if (h0 <= 0 || h1 <= 0)
        continue;
      const d0 = (values[i] - values[i - 1]) / h0;
      const d1 = (values[i + 1] - values[i]) / h1;
      if (d0 * d1 <= 0)
        continue;
      const w0 = 2 * h1 + h0;
      const w1 = h1 + 2 * h0;
      slopes[i] = (w0 + w1) / (w0 / d0 + w1 / d1);
    }
    return slopes;
  }
  // packages/core/src/camera.ts
  function key(t, zoom, x = 0.5, y = 0.5, ease = "spline") {
    return { t, zoom, x, y, ease };
  }
  class Camera {
    zoom;
    x;
    y;
    ceiling;
    out;
    canvas;
    constructor(zoom, x, y, ceiling, out, canvas) {
      this.zoom = zoom;
      this.x = x;
      this.y = y;
      this.ceiling = ceiling;
      this.out = out;
      this.canvas = canvas;
    }
    static build(keys, source, fit, ceiling, out) {
      const [srcW, srcH] = source;
      const frame = canvas(source, fit, out);
      const [canW, canH, offX, offY] = frame;
      const times = keys.map((k) => k.t);
      const eases = keys.map((k) => k.ease);
      return new Camera(Channel.build(times, keys.map((k) => Math.log(clamp(k.zoom, 1, ceiling))), eases), Channel.build(times, keys.map((k) => (clamp(k.x, 0, 1) * srcW + offX) / canW), eases), Channel.build(times, keys.map((k) => (clamp(k.y, 0, 1) * srcH + offY) / canH), eases), ceiling, out, frame);
    }
    zoomExpression() {
      return `min(max(exp(${this.zoom.expression()}),1),${this.ceiling.toFixed(6)})`;
    }
    view(t) {
      const zoom = clamp(Math.exp(this.zoom.at(t)), 1, this.ceiling);
      const half = 0.5 / zoom;
      return [zoom, clamp(this.x.at(t), half, 1 - half), clamp(this.y.at(t), half, 1 - half)];
    }
  }
  // packages/core/src/shot.ts
  var MOVES = ["hold", "focus", "frame", "pull-back", "pan-to", "punch-in", "drift", "tour"];
  var DEFAULT_LENGTH = {
    hold: 0.5,
    focus: 1.8,
    frame: 1.6,
    "pull-back": 1.6,
    "pan-to": 1.4,
    "punch-in": 0.35
  };

  class ShotError extends Error {
  }
  function pointOf(beat) {
    if (beat.rect) {
      const [x, y, w, h] = beat.rect.map(Number);
      return [x + w / 2, y + h / 2];
    }
    if (beat.point)
      return [Number(beat.point[0]), Number(beat.point[1])];
    return null;
  }
  function fitZoom(rect, fill, source, fit, out) {
    const [canW, canH] = canvas(source, fit, out);
    const width = Math.max(rect[2] * source[0], 1);
    const height = Math.max(rect[3] * source[1], 1);
    return fill * Math.min(canW / width, canH / height);
  }
  function resolveTime(value, previousEnd, length) {
    if (value === undefined || value === null)
      return previousEnd;
    if (typeof value === "number")
      return value;
    const text = String(value).trim();
    if (text.startsWith("+"))
      return previousEnd + parseNumber(text.slice(1));
    if (text.startsWith("end")) {
      if (length === null)
        throw new ShotError(`${JSON.stringify(text)} needs the take's length`);
      const rest = text.slice(3).trim();
      return length + (rest ? parseNumber(rest) : 0);
    }
    return parseNumber(text);
  }
  function parseNumber(text) {
    const value = Number(text);
    if (text.trim() === "" || Number.isNaN(value))
      throw new ShotError(`bad time ${JSON.stringify(text)}`);
    return value;
  }
  function planShot(raw, source, fit, ceiling, out, length) {
    let zoom = 1;
    let x = 0.5;
    let y = 0.5;
    const keys = [key(0, zoom, x, y)];
    const beats = [];
    const warnings = [];
    if (!raw.length)
      throw new ShotError("a shot needs at least one beat");
    const last = () => keys[keys.length - 1];
    const place = (t, z, px, py, ease) => {
      if (t < last().t - 0.000001) {
        throw new ShotError(`beat at ${t.toFixed(2)}s starts before the previous one ends (${last().t.toFixed(2)}s)`);
      }
      if (t - last().t < 0.000001)
        keys[keys.length - 1] = key(last().t, z, px, py, last().ease);
      else
        keys.push(key(t, z, px, py, ease));
    };
    const clampZoom = (z) => clamp(z, 1, ceiling);
    raw.forEach((beat, index) => {
      const move = beat.move;
      if (!MOVES.includes(move)) {
        throw new ShotError(`beat ${index}: unknown move ${JSON.stringify(move)}, want one of ${MOVES.join(", ")}`);
      }
      const start = resolveTime(beat.at, last().t, length);
      place(start, zoom, x, y, "spline");
      let duration;
      if (move === "drift") {
        const following = raw[index + 1]?.at;
        const defaultEnd = following !== undefined ? resolveTime(following, start, length) : length !== null ? length : start + 3;
        duration = Number(beat.for ?? defaultEnd - start);
      } else if (move === "tour") {
        duration = 0;
      } else {
        duration = Number(beat.for ?? DEFAULT_LENGTH[move]);
      }
      if (move !== "tour" && !(duration > 0))
        throw new ShotError(`beat ${index} (${move}): duration must be positive`);
      const ease = beat.ease;
      if (ease !== undefined && !isCameraEase(ease)) {
        throw new ShotError(`beat ${index}: unknown ease ${JSON.stringify(ease)}, want one of ${CAMERA_EASE_NAMES.join(", ")}`);
      }
      const target = (what) => {
        const point = pointOf(beat);
        if (!point)
          throw new ShotError(`beat ${index} (${what}): needs \`rect\` or \`point\``);
        return point;
      };
      let requested = null;
      switch (move) {
        case "hold":
          place(start + duration, zoom, x, y, "spline");
          break;
        case "focus":
        case "frame": {
          const point = target(move);
          if (beat.zoom !== undefined)
            requested = Number(beat.zoom);
          else if (beat.rect)
            requested = fitZoom(beat.rect, Number(beat.fill ?? 0.5), source, fit, out);
          else
            requested = 1.28;
          zoom = clampZoom(requested);
          [x, y] = point;
          place(start + duration, zoom, x, y, ease ?? "spline");
          break;
        }
        case "pull-back":
          zoom = 1;
          x = 0.5;
          y = 0.5;
          place(start + duration, zoom, x, y, ease ?? "spline");
          break;
        case "pan-to":
          [x, y] = target(move);
          place(start + duration, zoom, x, y, ease ?? "spline");
          break;
        case "punch-in": {
          requested = zoom * Number(beat.amount ?? 1.12);
          zoom = clampZoom(requested);
          const point = pointOf(beat);
          if (point)
            [x, y] = point;
          place(start + duration, zoom, x, y, ease ?? "back");
          break;
        }
        case "drift":
          requested = zoom * Number(beat.amount ?? 1.04);
          zoom = clampZoom(requested);
          place(start + duration, zoom, x, y, ease ?? "linear");
          break;
        case "tour": {
          const stops = beat.stops ?? [];
          if (!stops.length)
            throw new ShotError(`beat ${index} (tour): needs \`stops\``);
          const travel = Number(beat.travel ?? 1.2);
          const hold = Number(beat.hold ?? 0.8);
          if (beat.zoom !== undefined) {
            requested = Number(beat.zoom);
            zoom = clampZoom(requested);
          }
          let t = start;
          for (const stop of stops) {
            const point = pointOf(Array.isArray(stop) ? { point: stop } : stop);
            if (!point)
              throw new ShotError(`beat ${index} (tour): each stop needs \`rect\` or \`point\``);
            [x, y] = point;
            t += travel;
            place(t, zoom, x, y, ease ?? "spline");
            if (hold > 0) {
              t += hold;
              place(t, zoom, x, y, "spline");
            }
          }
          duration = t - start;
          break;
        }
      }
      const clamped = requested !== null && requested > ceiling + 0.000001;
      if (clamped) {
        warnings.push(`beat ${index} (${move}) asks for zoom ${requested.toFixed(3)}; clamped to the ceiling ${ceiling.toFixed(3)}`);
      }
      beats.push({ move, start: round4(start), end: round4(start + duration), clamped });
    });
    return { keys, beats, warnings };
  }
  function round4(value) {
    return Math.round(value * 1e4) / 1e4;
  }
  // packages/core/src/review.ts
  var SAMPLE_RATE = 60;
  function review(camera, keys, beats, length) {
    const warnings = [];
    const lastKey = keys[keys.length - 1];
    const end = Math.max(length ?? 0, lastKey.t);
    const steps = Math.max(Math.floor(end * SAMPLE_RATE), 1);
    let pan = 0;
    let zoomRate = 0;
    let firstMotion = null;
    let lastMotion = null;
    let previous = camera.view(0);
    for (let i = 1;i <= steps; i++) {
      const view = camera.view(i / SAMPLE_RATE);
      const dx = (view[1] - previous[1]) * view[0];
      const dy = (view[2] - previous[2]) * view[0] * camera.out[1] / camera.out[0];
      const speed = Math.hypot(dx, dy) * SAMPLE_RATE;
      const rate = Math.abs(Math.log(view[0] / previous[0])) * SAMPLE_RATE;
      pan = Math.max(pan, speed);
      zoomRate = Math.max(zoomRate, rate);
      if (speed > 0.001 || rate > 0.001) {
        firstMotion ??= i / SAMPLE_RATE;
        lastMotion = i / SAMPLE_RATE;
      }
      previous = view;
    }
    if (firstMotion !== null && firstMotion < 0.3) {
      warnings.push(`camera moves at ${firstMotion.toFixed(2)}s; hold 0.3–0.6 s before the first move`);
    }
    if (lastMotion !== null && length !== null && length - lastMotion < 0.3) {
      warnings.push(`camera still moving at ${lastMotion.toFixed(2)}s of ${length.toFixed(2)}s; leave 0.3 s still at the end`);
    }
    if (pan > 0.8)
      warnings.push(`pan peaks at ${pan.toFixed(2)} frame widths/s; above ~0.8 it reads as a blur`);
    if (zoomRate > 0.6 && !beats.some((b) => b.move === "punch-in")) {
      warnings.push(`zoom changes ${zoomRate.toFixed(2)}x/s at its peak; slow it down or use punch-in on purpose`);
    }
    if (length !== null && lastKey.t > length + 0.000001) {
      warnings.push(`last keyframe at ${lastKey.t.toFixed(2)}s is past the end of the take (${length.toFixed(2)}s)`);
    }
    const moves = beats.filter((b) => b.move !== "hold");
    for (let i = 1;i < moves.length; i++) {
      const a = moves[i - 1];
      const b = moves[i];
      if (b.start - a.start < 1.5 && a.move !== "punch-in" && b.move !== "punch-in") {
        warnings.push(`${a.move} at ${a.start.toFixed(2)}s and ${b.move} at ${b.start.toFixed(2)}s are under 1.5 s apart`);
      }
    }
    return { peak_pan: round3(pan), peak_zoom_rate: round3(zoomRate), warnings };
  }
  // packages/core/src/explain.ts
  function shot(input) {
    return shotFor(input, parseAspect(input.aspect ?? "16:9"));
  }
  function shotFor(input, out) {
    const { source, fit = "pad", length = null } = input;
    const ceiling = ceilingFor(source, fit, out);
    let keys;
    let beats = [];
    const warnings = [];
    if (input.beats) {
      const plan = planShot(input.beats, source, fit, ceiling, out, length);
      ({ keys, beats } = plan);
      warnings.push(...plan.warnings);
    } else {
      keys = [...input.keys ?? []].sort((a, b) => a.t - b.t);
      for (const k of keys) {
        if (k.zoom > ceiling + 0.000001) {
          warnings.push(`zoom ${k.zoom.toFixed(3)} at ${k.t.toFixed(2)}s clamped to the ceiling ${ceiling.toFixed(3)}`);
        }
      }
    }
    const zooms = keys.map((k) => round3(clamp(k.zoom, 1, ceiling)));
    const clamped = keys.some((k, i) => Math.abs(k.zoom - zooms[i]) > 0.000001) || beats.some((b) => b.clamped);
    const upscaled = canvas(source, fit, out)[0] < out[0];
    if (upscaled)
      warnings.push(`the canvas is narrower than ${out[0]} px; text will be soft at any zoom`);
    const camera = Camera.build(keys, source, fit, ceiling, out);
    const checks = review(camera, keys, beats, length);
    warnings.push(...checks.warnings);
    return {
      camera,
      keys,
      beats,
      out,
      fit,
      ceiling,
      upscaled,
      zooms,
      clamped,
      warnings,
      explain: () => ({
        ok: true,
        source,
        output: out,
        fit,
        ceiling,
        upscaled,
        length: length !== null ? round3(length) : null,
        keys: keys.map((k, i) => [k.t, zooms[i], k.x, k.y].map((v) => v.toFixed(3)).join(":") + `:${k.ease}`),
        beats,
        peak_pan: checks.peak_pan,
        peak_zoom_rate: checks.peak_zoom_rate,
        warnings
      })
    };
  }
  // site/src/camera.ts
  var DollyCamera = {
    EASES: CAMERA_EASES,
    POINTER_EASES,
    aspectSize: parseAspect,
    canvasFor: canvas,
    ceilingFor,
    shot
  };
  window.DollyCamera = DollyCamera;
})();
