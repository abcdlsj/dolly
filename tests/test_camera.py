"""camera.py against synthetic takes: a grey window with one red marker.

Run with `python3 -m unittest discover tests`. The render cases need ffmpeg
and skip without it.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(ROOT, "scripts", "camera.py")
spec = importlib.util.spec_from_file_location("camera", SCRIPT)
camera = importlib.util.module_from_spec(spec)
sys.modules["camera"] = camera  # dataclasses look their module up by name
spec.loader.exec_module(camera)

HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def make_take(path: str, size: tuple[int, int], marker: tuple[float, float], seconds: float = 3.0) -> None:
    width, height = size
    x, y = int(width * marker[0]) - 12, int(height * marker[1]) - 12
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-f", "lavfi", "-i", f"color=c=gray:s={width}x{height}:d={seconds}:r=30",
            "-vf", f"drawbox=x={x}:y={y}:w=24:h=24:color=red:t=fill",
            "-pix_fmt", "yuv420p", path,
        ],
        check=True,
    )


def marker_at(path: str, at: float) -> tuple[float, float] | None:
    """Where the red marker sits in one output frame, normalised."""
    raw = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", str(at), "-i", path,
            "-frames:v", "1", "-vf", "scale=480:270", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
        ],
        check=True, capture_output=True,
    ).stdout
    xs, ys = [], []
    for index in range(0, len(raw), 3):
        r, g = raw[index], raw[index + 1]
        if r > 160 and g < 100:
            pixel = index // 3
            xs.append(pixel % 480)
            ys.append(pixel // 480)
    if not xs:
        return None
    return sum(xs) / len(xs) / 480, sum(ys) / len(ys) / 270


def run(*args: str) -> dict:
    out = subprocess.run([sys.executable, SCRIPT, *args], check=True, capture_output=True, text=True).stdout
    return json.loads(out)


def stream(path: str) -> dict:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error", "-count_frames", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,nb_read_frames", "-of", "json", path,
        ],
        check=True, capture_output=True, text=True,
    ).stdout
    return json.loads(out)["streams"][0]


class Geometry(unittest.TestCase):
    def test_canvas_is_16_9_and_holds_the_window(self):
        for size in [(2560, 1600), (2880, 1200), (1600, 2400), (1280, 800)]:
            width, height, x, y = camera.canvas(size, "pad")
            self.assertAlmostEqual(width / height, 16 / 9, places=2)
            self.assertGreaterEqual(x, 0)
            self.assertGreaterEqual(y, 0)
            width, height, x, y = camera.canvas(size, "crop")
            self.assertAlmostEqual(width / height, 16 / 9, places=2)
            self.assertLessEqual(width, size[0])
            self.assertLessEqual(height, size[1])

    def test_ceiling_follows_the_canvas_and_never_drops_below_one(self):
        self.assertEqual(camera.ceiling_for((2560, 1600), "crop"), 1.333)
        self.assertEqual(camera.ceiling_for((2880, 1200), "crop"), 1.111)
        self.assertGreater(camera.ceiling_for((1600, 2400), "pad"), 2.0)
        self.assertEqual(camera.ceiling_for((1280, 800), "pad"), 1.0)

    def test_start_does_not_shift_keyframes(self):
        graph = camera.build_filter(
            [camera.Key(0.0, 1.0), camera.Key(1.0, 1.3)], (2560, 1600), 1.0, None, 1.333,
        )
        self.assertIn("trim=start=1.0", graph)
        self.assertIn("lt(t,1.0000)", graph)
        self.assertNotIn("2.0000", graph)

    def test_frame_rate_comes_from_the_stamps(self):
        with tempfile.TemporaryDirectory() as directory:
            for index in range(20):
                open(os.path.join(directory, f"{1_700_000_000_000 + index * 16}.png"), "wb").close()
            self.assertAlmostEqual(camera.frame_rate(directory), 62.5, places=1)


class Curves(unittest.TestCase):
    def build(self, keys):
        return camera.Camera.build(keys, (2560, 1600), "pad", 1.481, (1920, 1080))

    def test_two_keyframes_are_a_smoothstep(self):
        path = self.build([camera.Key(0, 1.0, 0.4, 0.5), camera.Key(2, 1.0, 0.6, 0.5)])
        start = path.x.at(0)
        end = path.x.at(2)
        for t in (0.5, 1.0, 1.5):
            u = t / 2
            self.assertAlmostEqual(path.x.at(t), start + (end - start) * u * u * (3 - 2 * u), places=6)

    def test_a_move_through_a_keyframe_does_not_stall_there(self):
        path = self.build([camera.Key(0, 1.2, 0.3, 0.5), camera.Key(1, 1.2, 0.5, 0.5),
                           camera.Key(2, 1.2, 0.7, 0.5)])
        speed = (path.x.at(1.01) - path.x.at(0.99)) / 0.02
        self.assertGreater(speed, 0.1)

    def test_a_repeated_keyframe_holds(self):
        path = self.build([camera.Key(0, 1.0, 0.3, 0.5), camera.Key(1, 1.0, 0.5, 0.5),
                           camera.Key(1.5, 1.0, 0.5, 0.5), camera.Key(2.5, 1.0, 0.7, 0.5)])
        self.assertAlmostEqual(path.x.at(1.0), path.x.at(1.5), places=9)
        self.assertAlmostEqual(path.x.at(1.25), path.x.at(1.0), places=9)

    def test_spline_never_overshoots(self):
        path = self.build([camera.Key(0, 1.0, 0.2, 0.5), camera.Key(0.3, 1.0, 0.6, 0.5),
                           camera.Key(3, 1.0, 0.62, 0.5)])
        peak = max(path.x.at(i / 100) for i in range(301))
        self.assertLessEqual(peak, path.x.at(3) + 1e-9)

    def test_zoom_eases_in_ratio(self):
        path = self.build([camera.Key(0, 1.0), camera.Key(2, 1.44)])
        self.assertAlmostEqual(path.view(1.0)[0], 1.2, places=6)

    def test_ffmpeg_expression_matches_python(self):
        path = self.build([camera.Key(0, 1.0, 0.3, 0.5), camera.Key(1, 1.2, 0.5, 0.5, "out"),
                           camera.Key(2, 1.3, 0.7, 0.5, "back")])
        expression = path.x.expression("T")
        for t in (0.0, 0.3, 1.0, 1.4, 1.9, 2.5):
            python = expression.replace("T", repr(t)).replace("if(", "_if(").replace("lt(", "_lt(")
            python = python.replace("clip(", "_clip(")
            value = eval(python, {"_if": lambda c, a, b: a if c else b, "_lt": lambda a, b: a < b,
                                  "_clip": lambda v, lo, hi: min(max(v, lo), hi)})
            self.assertAlmostEqual(value, path.x.at(t), places=5)

    def test_keyframe_and_aspect_parsing(self):
        self.assertEqual(camera.parse_keyframe("1:1.2:0.3:0.4:out").ease, "out")
        self.assertEqual(camera.parse_keyframe("1:1.2").x, 0.5)
        self.assertEqual(camera.parse_aspect("16:9"), (1920, 1080))
        self.assertEqual(camera.parse_aspect("9:16"), (1080, 1920))
        self.assertEqual(camera.parse_aspect("1:1"), (1080, 1080))
        self.assertEqual(camera.parse_aspect("4:5"), (1080, 1350))


class Shots(unittest.TestCase):
    source = (2560, 1600)

    def plan(self, beats, length=6.0):
        ceiling = camera.ceiling_for(self.source, "pad")
        return camera.plan_shot({"beats": beats}, self.source, "pad", ceiling, (1920, 1080), length)

    def test_focus_fits_the_rect(self):
        plan = self.plan([{"move": "focus", "at": 0.4, "rect": [0.4, 0.4, 0.2, 0.2], "fill": 0.25}])
        last = plan.keys[-1]
        # 0.2 of a 1600-high window is 320 px of a 1600 canvas; a quarter of the frame is zoom 1.25.
        self.assertAlmostEqual(last.zoom, 0.25 * 1600 / 320, places=3)
        self.assertAlmostEqual(last.x, 0.5)
        self.assertAlmostEqual(last.y, 0.5)
        self.assertEqual([k.t for k in plan.keys], [0.0, 0.4, 2.2])

    def test_relative_and_end_times(self):
        plan = self.plan([
            {"move": "focus", "at": 0.5, "point": [0.3, 0.3], "zoom": 1.2},
            {"move": "pan-to", "at": "+0.5", "point": [0.7, 0.3]},
            {"move": "pull-back", "at": "end-2"},
        ], length=8.0)
        self.assertEqual([b.start for b in plan.beats], [0.5, 2.8, 6.0])
        self.assertEqual(plan.keys[-1].zoom, 1.0)

    def test_overlapping_beats_are_refused(self):
        with self.assertRaises(camera.ShotError):
            self.plan([{"move": "focus", "at": 0.5, "point": [0.3, 0.3]},
                       {"move": "pan-to", "at": 1.0, "point": [0.7, 0.3]}])

    def test_clamped_zoom_is_reported(self):
        plan = self.plan([{"move": "focus", "at": 0.5, "point": [0.5, 0.5], "zoom": 3}])
        self.assertTrue(plan.beats[0].clamped)
        self.assertTrue(plan.warnings)

    def test_tour_and_drift(self):
        plan = self.plan([
            {"move": "tour", "at": 0.4, "zoom": 1.2, "stops": [[0.3, 0.3], [0.7, 0.3]], "hold": 0.5},
            {"move": "drift"},
        ])
        self.assertEqual([round(k.t, 2) for k in plan.keys], [0.0, 0.4, 1.6, 2.1, 3.3, 3.8, 6.0])
        self.assertEqual(plan.keys[-1].ease, "linear")
        self.assertAlmostEqual(plan.keys[-1].zoom, 1.2 * 1.04)

    def test_review_flags_an_early_move(self):
        plan = self.plan([{"move": "focus", "at": 0.0, "point": [0.5, 0.5], "zoom": 1.3}])
        path = camera.Camera.build(plan.keys, self.source, "pad", 1.481, (1920, 1080))
        warnings = camera.review(path, plan.keys, plan.beats, 6.0)["warnings"]
        self.assertTrue(any("before the first move" in w for w in warnings))


@unittest.skipUnless(HAS_FFMPEG, "needs ffmpeg")
class Render(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.mkdtemp()

    def tearDown(self):
        shutil.rmtree(self.directory, ignore_errors=True)

    def path(self, name: str) -> str:
        return os.path.join(self.directory, name)

    def test_every_window_shape_renders_1080p(self):
        for size in [(2560, 1600), (2880, 1200), (1600, 2400), (1280, 800)]:
            for fit in ("pad", "crop"):
                with self.subTest(size=size, fit=fit):
                    take = self.path(f"take-{size[0]}x{size[1]}.mp4")
                    if not os.path.exists(take):
                        make_take(take, size, (0.5, 0.5), seconds=2.0)
                    out = self.path(f"out-{size[0]}-{fit}.mp4")
                    result = run("--input", take, "--out", out, "--fit", fit,
                                 "--keys", "0:1.0", "1.5:1.3")
                    self.assertTrue(result["ok"])
                    info = stream(out)
                    self.assertEqual((info["width"], info["height"]), (1920, 1080))
                    self.assertEqual(int(info["nb_read_frames"]), 60)

    def test_push_in_lands_on_the_named_point(self):
        take = self.path("take.mp4")
        make_take(take, (2560, 1600), (0.6, 0.55))
        for fit in ("pad", "crop"):
            with self.subTest(fit=fit):
                out = self.path(f"push-{fit}.mp4")
                run("--input", take, "--out", out, "--fit", fit,
                    "--keys", "0:1.0:0.6:0.55", "1.5:1.3:0.6:0.55")
                x, y = marker_at(out, 2.5)
                self.assertAlmostEqual(x, 0.5, delta=0.02)
                self.assertAlmostEqual(y, 0.5, delta=0.02)

    def test_zoom_actually_moves(self):
        take = self.path("take.mp4")
        make_take(take, (2560, 1600), (0.5, 0.5))
        out = self.path("zoom.mp4")
        run("--input", take, "--out", out, "--keys", "0:1.0", "2:1.33")
        early, late = marker_at(out, 0.05), marker_at(out, 2.8)
        self.assertIsNotNone(early)
        self.assertIsNotNone(late)
        # The marker grows with the zoom; compare its spread via a wider crop.
        small = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", "0.05", "-i", out, "-frames:v", "1",
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], check=True, capture_output=True).stdout
        large = subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", "2.8", "-i", out, "-frames:v", "1",
             "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], check=True, capture_output=True).stdout

        def red(raw: bytes) -> int:
            return sum(1 for i in range(0, len(raw), 3) if raw[i] > 160 and raw[i + 1] < 100)

        self.assertGreater(red(large), red(small) * 1.4)

    def test_portrait_output(self):
        take = self.path("take.mp4")
        make_take(take, (2560, 1600), (0.5, 0.5), seconds=1.0)
        out = self.path("story.mp4")
        result = run("--input", take, "--out", out, "--aspect", "9:16", "--keys", "0:1.0", "0.8:1.5")
        self.assertEqual(result["output"], [1080, 1920])
        info = stream(out)
        self.assertEqual((info["width"], info["height"]), (1080, 1920))

    def test_shot_lands_on_the_rect(self):
        take = self.path("take.mp4")
        make_take(take, (2560, 1600), (0.6, 0.55), seconds=3.0)
        shot = self.path("shot.json")
        with open(shot, "w", encoding="utf-8") as handle:
            json.dump({"source": "take.mp4", "out": "shot.mp4", "beats": [
                {"move": "hold", "for": 0.4},
                {"move": "focus", "rect": [0.55, 0.5, 0.1, 0.1], "fill": 0.2, "for": 1.2},
            ]}, handle)
        explain = run("--shot", shot, "--explain")
        self.assertEqual(len(explain["keys"]), 3)
        result = run("--shot", shot)
        self.assertTrue(os.path.exists(result["out"]))
        x, y = marker_at(result["out"], 2.5)
        self.assertAlmostEqual(x, 0.5, delta=0.02)
        self.assertAlmostEqual(y, 0.5, delta=0.02)

    def test_start_trims_the_take(self):
        take = self.path("take.mp4")
        make_take(take, (2560, 1600), (0.5, 0.5), seconds=3.0)
        out = self.path("start.mp4")
        run("--input", take, "--out", out, "--start", "1", "--keys", "0:1.0", "1:1.2")
        self.assertEqual(int(stream(out)["nb_read_frames"]), 60)


if __name__ == "__main__":
    unittest.main()
