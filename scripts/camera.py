#!/usr/bin/env python3
"""Eased camera moves over a window recording.

A shot is a list of keyframes: at time `t` the frame shows the source point
(`x`, `y`) — normalised 0..1 — at magnification `zoom`. Between keyframes the
camera eases with a smoothstep, so a push-in starts and stops softly instead
of snapping.

    camera.py --input take.mp4 --out push-in.mp4 \
        --keys 0:1.0:0.5:0.5 0.4:1.0:0.5:0.5 2.6:1.28:0.18:0.34 --strip strip.jpg

The source is captured at 2x, so the sharp ceiling is srcWidth/1920. Zoom
beyond it is clamped and reported: upscaling makes text soft.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys

OUT_W, OUT_H = 1920, 1080


def parse_keyframe(text: str) -> tuple[float, float, float, float]:
    """`t:zoom:x:y`, with `t` in seconds and `x`,`y`,`zoom` optional."""
    parts = text.split(":")
    if len(parts) < 2 or len(parts) > 4:
        raise argparse.ArgumentTypeError(f"bad keyframe {text!r}, want t:zoom:x:y")
    t, zoom = float(parts[0]), float(parts[1])
    x = float(parts[2]) if len(parts) > 2 else 0.5
    y = float(parts[3]) if len(parts) > 3 else 0.5
    return t, zoom, x, y


def smoothstep(value: str, start: float, end: float, a: float, b: float) -> str:
    span = max(end - start, 1e-6)
    u = f"(({value}-{start:.4f})/{span:.4f})"
    return f"({a:.6f}+({b - a:.6f})*{u}*{u}*(3-2*{u}))"


def piecewise(name: str, keys: list[tuple[float, float]], limit: tuple[float, float]) -> str:
    """One ffmpeg expression evaluating `keys` at `t`, clamped to `limit`."""
    expression = f"{keys[-1][1]:.6f}"
    for index in range(len(keys) - 2, -1, -1):
        start, a = keys[index]
        end, b = keys[index + 1]
        expression = f"if(lt(t,{end:.4f}),{smoothstep('t', start, end, a, b)},{expression})"
    return f"min(max({expression},{limit[0]:.6f}),{limit[1]:.6f})"


def build_filter(
    keys: list[tuple[float, float, float, float]],
    source: tuple[int, int],
    start: float,
    duration: float | None,
    ceiling: float,
    fit: str = "pad",
) -> str:
    """The filter graph for one move.

    `crop` cannot animate its own width, so the move is built the other way
    round: the whole frame is scaled by the current zoom (a scale CAN be
    evaluated per frame), and a constant 1920x1080 window then pans over it.
    Below the ceiling that scale is a downscale, so nothing is upsampled.
    """
    src_w, src_h = source
    # `trim` + `setpts` restart the clock at zero, so keyframe times are
    # already relative to the wanted span; adding `start` would shift the move.
    times = [k[0] for k in keys]
    zoom = piecewise("zoom", [(t, min(max(k[1], 1.0), ceiling)) for t, k in zip(times, keys)], (1.0, ceiling))
    center_x = piecewise("cx", [(t, min(max(k[2], 0.0), 1.0)) for t, k in zip(times, keys)], (0.0, 1.0))
    center_y = piecewise("cy", [(t, min(max(k[3], 0.0), 1.0)) for t, k in zip(times, keys)], (0.0, 1.0))

    steps = [
        f"trim=start={start}:duration={duration}" if duration else f"trim=start={start}",
        "setpts=PTS-STARTPTS",
    ]
    # Bring the window into 16:9 first: pad keeps all of it, crop fills the
    # frame by trimming the sides or the top. Either way the rest of the graph
    # works on a 16:9 canvas and never stretches the picture.
    steps.append(
        "pad=w='max(iw,ih*16/9)':h='max(ih,iw*9/16)':x='(ow-iw)/2':y='(oh-ih)/2':color=0x0b0b0b"
        if fit == "pad"
        else "crop=w='min(iw,ih*16/9)':h='min(ih,iw*9/16)'"
    )
    steps += [
        "setsar=1",
        f"scale=w='trunc({OUT_W}*({zoom})/2)*2':h='trunc({OUT_H}*({zoom})/2)*2':eval=frame"
        ":flags=lanczos",
        f"crop=w={OUT_W}:h={OUT_H}"
        f":x='trunc(min(max(({center_x})*{OUT_W}*({zoom})-{OUT_W // 2},0),{OUT_W}*({zoom})-{OUT_W}))'"
        f":y='trunc(min(max(({center_y})*{OUT_H}*({zoom})-{OUT_H // 2},0),{OUT_H}*({zoom})-{OUT_H}))'",
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


def frame_rate(directory: str) -> float:
    """The capture rate a frame directory actually has.

    Frames are named by millisecond stamp, so the median gap is the real
    interval: assuming a fixed rate would retime takes that were captured
    faster or slower than it.
    """
    stamps = []
    for name in os.listdir(directory):
        stem = os.path.splitext(name)[0]
        if name.endswith(".png") and stem.isdigit():
            stamps.append(int(stem))
    if len(stamps) < 2:
        return 30.0
    stamps.sort()
    gaps = sorted(b - a for a, b in zip(stamps, stamps[1:]) if b > a)
    median = gaps[len(gaps) // 2]
    return 1000.0 / median if median else 30.0


def input_args(path: str, pattern: bool, fps: float) -> list[str]:
    if pattern:
        return ["-framerate", f"{fps:.3f}", "-pattern_type", "glob", "-i", os.path.join(path, "*.png")]
    return ["-i", path]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--input", required=True, help="clip, or a directory of timestamped PNG frames")
    parser.add_argument("--frames", action="store_true", help="treat --input as a frame directory")
    parser.add_argument("--out", required=True, help="output clip")
    parser.add_argument("--keys", nargs="+", type=parse_keyframe, required=True,
                        help="keyframes as t:zoom:x:y (x,y normalised, default centre)")
    parser.add_argument("--start", type=float, default=0.0, help="start time inside the input")
    parser.add_argument("--duration", type=float, default=None, help="length of the move")
    parser.add_argument("--fit", choices=["pad", "crop"], default="pad",
                        help="pad keeps the source aspect (letterboxed); crop fills the frame")
    parser.add_argument("--fps", type=float, default=None,
                        help="frame directory rate; read from the frame timestamps by default")
    parser.add_argument("--crf", type=int, default=16)
    parser.add_argument("--strip", help="also write a 5-frame contact strip here")
    parser.add_argument("--dry-run", action="store_true", help="print the filter instead of encoding")
    args = parser.parse_args()

    if shutil.which("ffmpeg") is None:
        print(json.dumps({"ok": False, "error": "ffmpeg not found"}))
        return 5

    probe_target = args.input if not args.frames else os.path.join(args.input, "*.png")
    try:
        source, _ = probe(args.input if not args.frames else sorted(
            os.path.join(args.input, f) for f in os.listdir(args.input) if f.endswith(".png")
        )[0])
    except Exception as error:  # noqa: BLE001 - reported to the caller
        print(json.dumps({"ok": False, "error": f"probe failed: {error}"}))
        return 5
    del probe_target

    ceiling = round(min(source[0] / OUT_W, source[1] / OUT_H), 3)
    fps = args.fps or (frame_rate(args.input) if args.frames else 0.0)
    keys = sorted(args.keys)
    requested = [k[1] for k in keys]
    clamped = [round(min(max(z, 1.0), ceiling), 3) for z in requested]
    graph = build_filter(keys, source, args.start, args.duration, ceiling, args.fit)

    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        *input_args(args.input, args.frames, fps or 30.0),
        "-vf", graph,
        "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
        "-crf", str(args.crf), "-preset", "slow", "-r", "30",
        args.out,
    ]
    if args.dry_run:
        print(graph)
        return 0

    subprocess.run(command, check=True)

    strip = None
    if args.strip:
        duration = args.duration or (probe(args.out)[1] or 1.0)
        strip = args.strip
        subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", args.out,
                "-vf", f"fps=5/{max(duration, 0.1):.3f},scale=480:-1,tile=5x1",
                "-frames:v", "1", strip,
            ],
            check=True,
        )

    print(json.dumps({
        "ok": True,
        "source": list(source),
        "ceiling": ceiling,
        "zoom": clamped,
        "clamped": any(abs(a - b) > 1e-6 for a, b in zip(requested, clamped)),
        "out": args.out,
        "fit": args.fit,
        "fps": round(fps, 2) if fps else None,
        "strip": strip,
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
