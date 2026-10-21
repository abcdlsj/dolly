#!/usr/bin/env python3
"""Eased camera moves over a window recording.

A shot is a list of keyframes: at time `t` the frame shows the window point
(`x`, `y`) — normalised 0..1 — at magnification `zoom`. Between keyframes the
camera follows a monotone spline, so a push-in starts and stops softly and a
move through several keyframes never stalls on the ones in the middle.

    camera.py --input take.mp4 --out push-in.mp4 \
        --keys 0:1.0:0.5:0.5 0.4:1.0:0.5:0.5 2.6:1.28:0.18:0.34 --strip strip.jpg

or, from named moves instead of numbers:

    camera.py --shot shot.json --out film.mp4
    camera.py --shot shot.json --explain     # keyframes and warnings, no render

The window is padded (or cropped) to the output aspect first, and the sharp
ceiling is that canvas's width / output width. Zoom beyond it is clamped and
reported: upscaling makes text soft. A canvas narrower than the output is
reported as `upscaled` and renders at zoom 1 only.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field

SHORT_SIDE = 1080
SAMPLE_RATE = 60.0

# Each ease maps segment progress u in 0..1 onto 0..1 as c0 + c1 u + c2 u² + c3 u³.
# `spline` is not listed: its cubic comes from the neighbouring keyframes.
BACK = 1.70158
EASES = {
    "smooth": (0.0, 0.0, 3.0, -2.0),
    "linear": (0.0, 1.0, 0.0, 0.0),
    "in": (0.0, 0.0, 0.0, 1.0),
    "out": (0.0, 3.0, -3.0, 1.0),
    "back": (0.0, 3 * (BACK + 1) - 2 * BACK, BACK - 3 * (BACK + 1), BACK + 1),
}
EASE_NAMES = ("spline", *EASES)


@dataclass
class Key:
    t: float
    zoom: float
    x: float = 0.5
    y: float = 0.5
    # How the camera arrives at this keyframe from the previous one.
    ease: str = "spline"


def parse_keyframe(text: str) -> Key:
    """`t:zoom:x:y:ease`, with `t` in seconds and everything after `zoom` optional."""
    parts = text.split(":")
    if len(parts) < 2 or len(parts) > 5:
        raise argparse.ArgumentTypeError(f"bad keyframe {text!r}, want t:zoom:x:y[:ease]")
    try:
        key = Key(float(parts[0]), float(parts[1]))
        if len(parts) > 2:
            key.x = float(parts[2])
        if len(parts) > 3:
            key.y = float(parts[3])
    except ValueError as error:
        raise argparse.ArgumentTypeError(f"bad keyframe {text!r}: {error}") from None
    if len(parts) > 4:
        if parts[4] not in EASE_NAMES:
            raise argparse.ArgumentTypeError(f"bad ease {parts[4]!r}, want one of {', '.join(EASE_NAMES)}")
        key.ease = parts[4]
    return key


def parse_aspect(text: str) -> tuple[int, int]:
    """`16:9` → the output size, with the short side at 1080."""
    try:
        across, down = (float(part) for part in text.split(":"))
    except ValueError:
        raise argparse.ArgumentTypeError(f"bad aspect {text!r}, want w:h such as 16:9") from None
    if across <= 0 or down <= 0:
        raise argparse.ArgumentTypeError(f"bad aspect {text!r}")
    if across >= down:
        return int(round(SHORT_SIDE * across / down / 2)) * 2, SHORT_SIDE
    return SHORT_SIDE, int(round(SHORT_SIDE * down / across / 2)) * 2


# MARK: - Geometry


def canvas(source: tuple[int, int], fit: str, out: tuple[int, int] = (1920, 1080)) -> tuple[int, int, int, int]:
    """The output-aspect canvas a window is brought into, and where the window sits on it.

    `pad` keeps the whole window (offsets are >= 0), `crop` fills the frame by
    trimming the sides or the top and bottom (offsets are <= 0). Sizes are even
    so every later scale lands on whole chroma samples.
    """
    src_w, src_h = source
    out_w, out_h = out
    if fit == "pad":
        width, height = max(src_w, src_h * out_w / out_h), max(src_h, src_w * out_h / out_w)
    else:
        width, height = min(src_w, src_h * out_w / out_h), min(src_h, src_w * out_h / out_w)
    width, height = int(round(width / 2)) * 2, int(round(height / 2)) * 2
    return width, height, (width - src_w) // 2, (height - src_h) // 2


def ceiling_for(source: tuple[int, int], fit: str, out: tuple[int, int] = (1920, 1080)) -> float:
    """The deepest zoom that still downscales the canvas, never below 1.

    A canvas narrower than the output is already upscaled at zoom 1; that is
    reported as `upscaled` rather than refused, so small windows still render.
    """
    return round(max(canvas(source, fit, out)[0] / out[0], 1.0), 3)


# MARK: - Curves


@dataclass
class Segment:
    start: float
    end: float
    coefficients: tuple[float, float, float, float]

    def at(self, t: float) -> float:
        u = min(max((t - self.start) / max(self.end - self.start, 1e-6), 0.0), 1.0)
        c0, c1, c2, c3 = self.coefficients
        return c0 + u * (c1 + u * (c2 + u * c3))


@dataclass
class Channel:
    """One eased value over time: a cubic per gap between keyframes."""

    first: float
    segments: list[Segment] = field(default_factory=list)

    @classmethod
    def build(cls, times: list[float], values: list[float], eases: list[str]) -> "Channel":
        slopes = tangents(times, values, eases)
        channel = cls(values[0])
        for index in range(len(times) - 1):
            t0, t1 = times[index], times[index + 1]
            a, b = values[index], values[index + 1]
            ease = eases[index + 1]
            if ease == "spline":
                h = t1 - t0
                m0, m1 = slopes[index] * h, slopes[index + 1] * h
                coefficients = (a, m0, -3 * a - 2 * m0 + 3 * b - m1, 2 * a + m0 - 2 * b + m1)
            else:
                f = EASES[ease]
                coefficients = (a + (b - a) * f[0], (b - a) * f[1], (b - a) * f[2], (b - a) * f[3])
            channel.segments.append(Segment(t0, t1, coefficients))
        return channel

    def at(self, t: float) -> float:
        if not self.segments or t <= self.segments[0].start:
            return self.first
        for segment in self.segments:
            if t < segment.end:
                return segment.at(t)
        return self.segments[-1].at(self.segments[-1].end)

    def expression(self, clock: str = "t") -> str:
        """The same curve as one ffmpeg expression of `clock`."""
        if not self.segments:
            return f"{self.first:.6f}"
        last = self.segments[-1]
        expression = f"{last.at(last.end):.6f}"
        for segment in reversed(self.segments):
            span = max(segment.end - segment.start, 1e-6)
            u = f"clip(({clock}-{segment.start:.4f})/{span:.4f},0,1)"
            c0, c1, c2, c3 = segment.coefficients
            cubic = f"({c0:.6f}+{u}*({c1:.6f}+{u}*({c2:.6f}+{u}*{c3:.6f})))"
            expression = f"if(lt({clock},{segment.end:.4f}),{cubic},{expression})"
        return expression


def tangents(times: list[float], values: list[float], eases: list[str]) -> list[float]:
    """Monotone (PCHIP) slopes at each keyframe, zero at the ends.

    A keyframe the camera holds on, turns back at, or that borders a
    non-spline segment gets slope zero, so the spline never overshoots and a
    hold really holds.
    """
    count = len(times)
    slopes = [0.0] * count
    for index in range(1, count - 1):
        if eases[index] != "spline" or eases[index + 1] != "spline":
            continue
        h0, h1 = times[index] - times[index - 1], times[index + 1] - times[index]
        if h0 <= 0 or h1 <= 0:
            continue
        d0 = (values[index] - values[index - 1]) / h0
        d1 = (values[index + 1] - values[index]) / h1
        if d0 * d1 <= 0:
            continue
        w0, w1 = 2 * h1 + h0, h1 + 2 * h0
        slopes[index] = (w0 + w1) / (w0 / d0 + w1 / d1)
    return slopes


@dataclass
class Camera:
    """The camera path of one shot, on the canvas the graph pans over."""

    zoom: Channel  # natural log of the zoom: equal ratios take equal time
    x: Channel
    y: Channel
    ceiling: float
    out: tuple[int, int]

    @classmethod
    def build(cls, keys: list[Key], source: tuple[int, int], fit: str, ceiling: float,
              out: tuple[int, int]) -> "Camera":
        src_w, src_h = source
        can_w, can_h, off_x, off_y = canvas(source, fit, out)
        times = [k.t for k in keys]
        eases = [k.ease for k in keys]
        zooms = [math.log(min(max(k.zoom, 1.0), ceiling)) for k in keys]
        # Keyframes name a point of the window; the pan works on the canvas, so
        # move each point by the padding or the trim before easing towards it.
        xs = [(min(max(k.x, 0.0), 1.0) * src_w + off_x) / can_w for k in keys]
        ys = [(min(max(k.y, 0.0), 1.0) * src_h + off_y) / can_h for k in keys]
        return cls(Channel.build(times, zooms, eases), Channel.build(times, xs, eases),
                   Channel.build(times, ys, eases), ceiling, out)

    def zoom_expression(self) -> str:
        return f"min(max(exp({self.zoom.expression()}),1),{self.ceiling:.6f})"

    def view(self, t: float) -> tuple[float, float, float]:
        """Zoom and the centre of the visible window, canvas-normalised, as rendered."""
        zoom = min(max(math.exp(self.zoom.at(t)), 1.0), self.ceiling)
        half = 0.5 / zoom
        x = min(max(self.x.at(t), half), 1 - half)
        y = min(max(self.y.at(t), half), 1 - half)
        return zoom, x, y


# MARK: - Shots


class ShotError(ValueError):
    pass


@dataclass
class Beat:
    move: str
    start: float
    end: float
    clamped: bool = False


@dataclass
class Plan:
    keys: list[Key]
    beats: list[Beat]
    warnings: list[str]


DEFAULT_LENGTH = {
    "hold": 0.5, "focus": 1.8, "frame": 1.6, "pull-back": 1.6, "pan-to": 1.4, "punch-in": 0.35,
}
MOVES = ("hold", "focus", "frame", "pull-back", "pan-to", "punch-in", "drift", "tour")


def point_of(beat: dict) -> tuple[float, float] | None:
    if "rect" in beat:
        x, y, w, h = (float(v) for v in beat["rect"])
        return x + w / 2, y + h / 2
    if "point" in beat:
        x, y = (float(v) for v in beat["point"])
        return x, y
    return None


def fit_zoom(rect: list[float], fill: float, source: tuple[int, int], fit: str,
             out: tuple[int, int]) -> float:
    """The zoom at which `rect` (window-normalised) takes `fill` of the frame."""
    can_w, can_h, _, _ = canvas(source, fit, out)
    width = max(float(rect[2]) * source[0], 1.0)
    height = max(float(rect[3]) * source[1], 1.0)
    return fill * min(can_w / width, can_h / height)


def resolve_time(value, previous_end: float, length: float | None) -> float:
    if value is None:
        return previous_end
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip()
    if text.startswith("+"):
        return previous_end + float(text[1:])
    if text.startswith("end"):
        if length is None:
            raise ShotError(f"{text!r} needs the take's length")
        rest = text[3:].strip()
        return length + (float(rest) if rest else 0.0)
    return float(text)


def plan_shot(shot: dict, source: tuple[int, int], fit: str, ceiling: float, out: tuple[int, int],
              length: float | None) -> Plan:
    """Expand named moves into keyframes, starting on the whole window."""
    zoom, x, y = 1.0, 0.5, 0.5
    keys = [Key(0.0, zoom, x, y)]
    beats: list[Beat] = []
    warnings: list[str] = []
    raw = shot.get("beats") or []
    if not raw:
        raise ShotError("a shot needs at least one beat")

    def place(t: float, z: float, px: float, py: float, ease: str) -> None:
        if t < keys[-1].t - 1e-6:
            raise ShotError(f"beat at {t:.2f}s starts before the previous one ends ({keys[-1].t:.2f}s)")
        if t - keys[-1].t < 1e-6:
            keys[-1] = Key(keys[-1].t, z, px, py, keys[-1].ease)
        else:
            keys.append(Key(t, z, px, py, ease))

    for index, beat in enumerate(raw):
        move = beat.get("move")
        if move not in MOVES:
            raise ShotError(f"beat {index}: unknown move {move!r}, want one of {', '.join(MOVES)}")
        start = resolve_time(beat.get("at"), keys[-1].t, length)
        # Whatever came before holds until this beat begins.
        place(start, zoom, x, y, "spline")

        if move == "drift":
            following = raw[index + 1].get("at") if index + 1 < len(raw) else None
            default_end = (resolve_time(following, start, length) if following is not None
                           else (length if length is not None else start + 3.0))
            duration = float(beat.get("for", default_end - start))
        elif move == "tour":
            duration = 0.0
        else:
            duration = float(beat.get("for", DEFAULT_LENGTH[move]))
        if move != "tour" and duration <= 0:
            raise ShotError(f"beat {index} ({move}): duration must be positive")
        ease = beat.get("ease")
        if ease is not None and ease not in EASE_NAMES:
            raise ShotError(f"beat {index}: unknown ease {ease!r}")

        requested = None
        if move == "hold":
            place(start + duration, zoom, x, y, "spline")
        elif move in ("focus", "frame"):
            target = point_of(beat)
            if target is None:
                raise ShotError(f"beat {index} ({move}): needs `rect` or `point`")
            if "zoom" in beat:
                requested = float(beat["zoom"])
            elif "rect" in beat:
                requested = fit_zoom(beat["rect"], float(beat.get("fill", 0.5)), source, fit, out)
            else:
                requested = 1.28
            zoom, (x, y) = min(max(requested, 1.0), ceiling), target
            place(start + duration, zoom, x, y, ease or "spline")
        elif move == "pull-back":
            zoom, x, y = 1.0, 0.5, 0.5
            place(start + duration, zoom, x, y, ease or "spline")
        elif move == "pan-to":
            target = point_of(beat)
            if target is None:
                raise ShotError(f"beat {index} (pan-to): needs `rect` or `point`")
            x, y = target
            place(start + duration, zoom, x, y, ease or "spline")
        elif move == "punch-in":
            requested = zoom * float(beat.get("amount", 1.12))
            zoom = min(max(requested, 1.0), ceiling)
            target = point_of(beat)
            if target is not None:
                x, y = target
            place(start + duration, zoom, x, y, ease or "back")
        elif move == "drift":
            requested = zoom * float(beat.get("amount", 1.04))
            zoom = min(max(requested, 1.0), ceiling)
            place(start + duration, zoom, x, y, ease or "linear")
        elif move == "tour":
            stops = beat.get("stops") or []
            if not stops:
                raise ShotError(f"beat {index} (tour): needs `stops`")
            travel = float(beat.get("travel", 1.2))
            hold = float(beat.get("hold", 0.8))
            if "zoom" in beat:
                requested = float(beat["zoom"])
                zoom = min(max(requested, 1.0), ceiling)
            t = start
            for stop in stops:
                target = point_of(stop if isinstance(stop, dict) else {"point": stop})
                if target is None:
                    raise ShotError(f"beat {index} (tour): each stop needs `rect` or `point`")
                x, y = target
                t += travel
                place(t, zoom, x, y, ease or "spline")
                if hold > 0:
                    t += hold
                    place(t, zoom, x, y, "spline")
            duration = t - start

        clamped = requested is not None and requested > ceiling + 1e-6
        if clamped:
            warnings.append(
                f"beat {index} ({move}) asks for zoom {requested:.3f}; clamped to the ceiling {ceiling:.3f}"
            )
        beats.append(Beat(move, round(start, 4), round(start + duration, 4), clamped))

    return Plan(keys, beats, warnings)


# MARK: - Explain


def review(camera: Camera, keys: list[Key], beats: list[Beat], length: float | None) -> dict:
    """Peak speeds and the rules from SKILL.md, checked before any render."""
    warnings: list[str] = []
    end = max(length or 0.0, keys[-1].t)
    steps = max(int(end * SAMPLE_RATE), 1)
    views = [camera.view(i / SAMPLE_RATE) for i in range(steps + 1)]
    pan, zoom_rate = 0.0, 0.0
    first_motion, last_motion = None, None
    for i in range(1, len(views)):
        (z0, x0, y0), (z1, x1, y1) = views[i - 1], views[i]
        # Pan speed in frame widths per second: canvas travel times the zoom.
        dx, dy = (x1 - x0) * z1, (y1 - y0) * z1 * camera.out[1] / camera.out[0]
        speed = math.hypot(dx, dy) * SAMPLE_RATE
        rate = abs(math.log(z1 / z0)) * SAMPLE_RATE
        pan, zoom_rate = max(pan, speed), max(zoom_rate, rate)
        if speed > 1e-3 or rate > 1e-3:
            t = i / SAMPLE_RATE
            first_motion = t if first_motion is None else first_motion
            last_motion = t
    if first_motion is not None and first_motion < 0.3:
        warnings.append(f"camera moves at {first_motion:.2f}s; hold 0.3–0.6 s before the first move")
    if last_motion is not None and length is not None and length - last_motion < 0.3:
        warnings.append(f"camera still moving at {last_motion:.2f}s of {length:.2f}s; leave 0.3 s still at the end")
    if pan > 0.8:
        warnings.append(f"pan peaks at {pan:.2f} frame widths/s; above ~0.8 it reads as a blur")
    if zoom_rate > 0.6 and not any(b.move == "punch-in" for b in beats):
        warnings.append(f"zoom changes {zoom_rate:.2f}x/s at its peak; slow it down or use punch-in on purpose")
    if length is not None and keys[-1].t > length + 1e-6:
        warnings.append(f"last keyframe at {keys[-1].t:.2f}s is past the end of the take ({length:.2f}s)")
    moves = [b for b in beats if b.move != "hold"]
    for a, b in zip(moves, moves[1:]):
        if b.start - a.start < 1.5 and "punch-in" not in (a.move, b.move):
            warnings.append(f"{a.move} at {a.start:.2f}s and {b.move} at {b.start:.2f}s are under 1.5 s apart")
    return {
        "peak_pan": round(pan, 3),
        "peak_zoom_rate": round(zoom_rate, 3),
        "warnings": warnings,
    }


# MARK: - Render


def build_filter(
    keys: list[Key],
    source: tuple[int, int],
    start: float,
    duration: float | None,
    ceiling: float,
    fit: str = "pad",
    out: tuple[int, int] = (1920, 1080),
) -> str:
    """The filter graph for one move.

    `crop` cannot animate its own width, so the move is built the other way
    round: the whole frame is scaled by the current zoom (a scale CAN be
    evaluated per frame), and a constant output-sized window then pans over it.
    Below the ceiling that scale is a downscale, so nothing is upsampled.
    """
    out_w, out_h = out
    can_w, can_h, off_x, off_y = canvas(source, fit, out)
    # `trim` + `setpts` restart the clock at zero, so keyframe times are
    # already relative to the wanted span; adding `start` would shift the move.
    camera = Camera.build(keys, source, fit, ceiling, out)
    zoom = camera.zoom_expression()
    center_x, center_y = camera.x.expression(), camera.y.expression()

    steps = [
        f"trim=start={start}:duration={duration}" if duration else f"trim=start={start}",
        "setpts=PTS-STARTPTS",
    ]
    # Bring the window into the output aspect first, so the rest of the graph
    # works on a canvas of that shape and never stretches the picture.
    steps.append(
        f"pad=w={can_w}:h={can_h}:x={off_x}:y={off_y}:color=0x0b0b0b"
        if fit == "pad"
        else f"crop=w={can_w}:h={can_h}:x={-off_x}:y={-off_y}"
    )
    steps += [
        "setsar=1",
        f"scale=w='trunc({out_w}*({zoom})/2)*2':h='trunc({out_h}*({zoom})/2)*2':eval=frame"
        ":flags=lanczos",
        f"crop=w={out_w}:h={out_h}"
        f":x='trunc(min(max(({center_x})*{out_w}*({zoom})-{out_w // 2},0),{out_w}*({zoom})-{out_w}))'"
        f":y='trunc(min(max(({center_y})*{out_h}*({zoom})-{out_h // 2},0),{out_h}*({zoom})-{out_h}))'",
        "format=yuv420p",
    ]
    return ",".join(steps)


def probe(path: str) -> tuple[tuple[int, int], float]:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height:format=duration",
            "-of", "json", path,
        ],
        check=True, capture_output=True, text=True,
    ).stdout
    data = json.loads(out)
    stream = data["streams"][0]
    return (int(stream["width"]), int(stream["height"])), float(data["format"].get("duration", 0))


def frame_stamps(directory: str) -> list[int]:
    stamps = []
    for name in os.listdir(directory):
        stem = os.path.splitext(name)[0]
        if name.endswith(".png") and stem.isdigit():
            stamps.append(int(stem))
    return sorted(stamps)


def frame_rate(directory: str) -> float:
    """The capture rate a frame directory actually has.

    Frames are named by millisecond stamp, so the median gap is the real
    interval: assuming a fixed rate would retime takes that were captured
    faster or slower than it.
    """
    stamps = frame_stamps(directory)
    if len(stamps) < 2:
        return 30.0
    gaps = sorted(b - a for a, b in zip(stamps, stamps[1:]) if b > a)
    median = gaps[len(gaps) // 2]
    return 1000.0 / median if median else 30.0


def input_args(path: str, pattern: bool, fps: float) -> list[str]:
    if pattern:
        return ["-framerate", f"{fps:.3f}", "-pattern_type", "glob", "-i", os.path.join(path, "*.png")]
    return ["-i", path]


def fail(message: str, code: int = 5) -> int:
    print(json.dumps({"ok": False, "error": message}))
    return code


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", help="clip, or a directory of timestamped PNG frames (a shot's `source` otherwise)")
    parser.add_argument("--frames", action="store_true", help="treat --input as a frame directory")
    parser.add_argument("--out", help="output clip (a shot's `out` otherwise)")
    moves = parser.add_mutually_exclusive_group(required=True)
    moves.add_argument("--keys", nargs="+", type=parse_keyframe,
                       help="keyframes as t:zoom:x:y[:ease] (x,y normalised, default centre)")
    moves.add_argument("--shot", help="a shot file of named moves (JSON), or - for stdin")
    parser.add_argument("--start", type=float, default=None, help="start time inside the input")
    parser.add_argument("--duration", type=float, default=None, help="length of the move")
    parser.add_argument("--fit", choices=["pad", "crop"], default=None,
                        help="pad keeps the source aspect (letterboxed, default); crop fills the frame")
    parser.add_argument("--aspect", type=parse_aspect, default=None,
                        help="output aspect, e.g. 16:9 (default), 9:16, 1:1, 4:5; short side 1080")
    parser.add_argument("--fps", type=float, default=None,
                        help="frame directory rate; read from the frame timestamps by default")
    parser.add_argument("--crf", type=int, default=None)
    parser.add_argument("--strip", help="also write a 5-frame contact strip here")
    parser.add_argument("--explain", action="store_true",
                        help="print the keyframes, peak speeds and rule warnings instead of encoding")
    parser.add_argument("--dry-run", action="store_true", help="print the filter instead of encoding")
    args = parser.parse_args()

    shot: dict = {}
    base = os.getcwd()
    if args.shot:
        try:
            if args.shot == "-":
                shot = json.load(sys.stdin)
            else:
                with open(args.shot, encoding="utf-8") as handle:
                    shot = json.load(handle)
                base = os.path.dirname(os.path.abspath(args.shot))
        except (OSError, json.JSONDecodeError) as error:
            return fail(f"cannot read shot: {error}", 2)
    output = shot.get("output", {})

    def from_shot(name: str) -> str | None:
        value = shot.get(name)
        return os.path.join(base, value) if isinstance(value, str) else None

    source_path = args.input or from_shot("source")
    out_path = args.out or from_shot("out")
    frames = args.frames or bool(shot.get("frames"))
    start = args.start if args.start is not None else float(shot.get("start", 0.0))
    duration = args.duration if args.duration is not None else shot.get("duration")
    fit = args.fit or output.get("fit", "pad")
    crf = args.crf if args.crf is not None else int(output.get("crf", 16))
    try:
        out = args.aspect or parse_aspect(str(output.get("aspect", "16:9")))
    except argparse.ArgumentTypeError as error:
        return fail(str(error), 2)
    if fit not in ("pad", "crop"):
        return fail(f"bad fit {fit!r}, want pad or crop", 2)
    if not source_path:
        return fail("no input: pass --input or give the shot a `source`", 2)
    if not out_path and not (args.explain or args.dry_run):
        return fail("no output: pass --out or give the shot an `out`", 2)

    if shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None:
        return fail("ffmpeg not found")

    try:
        if frames:
            stamps = frame_stamps(source_path)
            if not stamps:
                return fail(f"no timestamped PNG frames in {source_path}")
            source, _ = probe(os.path.join(source_path, f"{stamps[0]}.png"))
        else:
            source, take_length = probe(source_path)
    except Exception as error:  # noqa: BLE001 - reported to the caller
        return fail(f"probe failed: {error}")

    ceiling = ceiling_for(source, fit, out)
    fps = args.fps or (frame_rate(source_path) if frames else 0.0)
    if frames:
        take_length = len(stamps) / (fps or 30.0)
    length = float(duration) if duration else (max(take_length - start, 0.0) or None)

    warnings: list[str] = []
    beats: list[Beat] = []
    if args.shot:
        try:
            plan = plan_shot(shot, source, fit, ceiling, out, length)
        except (ShotError, TypeError, ValueError) as error:
            return fail(f"bad shot: {error}", 2)
        keys, beats, warnings = plan.keys, plan.beats, plan.warnings
    else:
        keys = sorted(args.keys, key=lambda k: k.t)
        for key in keys:
            if key.zoom > ceiling + 1e-6:
                warnings.append(f"zoom {key.zoom:.3f} at {key.t:.2f}s clamped to the ceiling {ceiling:.3f}")

    requested = [k.zoom for k in keys]
    clamped = [round(min(max(z, 1.0), ceiling), 3) for z in requested]
    upscaled = canvas(source, fit, out)[0] < out[0]
    if upscaled:
        warnings.append(f"the canvas is narrower than {out[0]} px; text will be soft at any zoom")
    camera = Camera.build(keys, source, fit, ceiling, out)
    checks = review(camera, keys, beats, length)
    warnings += checks["warnings"]

    if args.explain:
        print(json.dumps({
            "ok": True,
            "source": list(source),
            "output": list(out),
            "fit": fit,
            "ceiling": ceiling,
            "upscaled": upscaled,
            "length": round(length, 3) if length else None,
            "keys": [f"{k.t:.3f}:{z:.3f}:{k.x:.3f}:{k.y:.3f}:{k.ease}" for k, z in zip(keys, clamped)],
            "beats": [{"move": b.move, "start": b.start, "end": b.end, "clamped": b.clamped} for b in beats],
            "peak_pan": checks["peak_pan"],
            "peak_zoom_rate": checks["peak_zoom_rate"],
            "warnings": warnings,
        }))
        return 0

    graph = build_filter(keys, source, start, duration, ceiling, fit, out)
    if args.dry_run:
        print(graph)
        return 0

    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        *input_args(source_path, frames, fps or 30.0),
        "-vf", graph,
        "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-crf", str(crf), "-preset", "slow", "-r", "30",
        out_path,
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return fail(f"ffmpeg failed: {result.stderr.strip()[-400:]}")

    strip = None
    if args.strip:
        strip_length = length or (probe(out_path)[1] or 1.0)
        strip = args.strip
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", out_path,
                "-vf", f"fps=5/{max(strip_length, 0.1):.3f},scale=480:-1,tile=5x1",
                "-frames:v", "1", strip,
            ],
            check=True,
        )

    print(json.dumps({
        "ok": True,
        "source": list(source),
        "output": list(out),
        "ceiling": ceiling,
        "upscaled": upscaled,
        "zoom": clamped,
        "clamped": any(abs(a - b) > 1e-6 for a, b in zip(requested, clamped)) or any(b.clamped for b in beats),
        "out": out_path,
        "fit": fit,
        "fps": round(fps, 2) if fps else None,
        "strip": strip,
        "warnings": warnings,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
