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
            [(0.0, 1.0, 0.5, 0.5), (1.0, 1.3, 0.5, 0.5)], (2560, 1600), 1.0, None, 1.333,
        )
        self.assertIn("trim=start=1.0", graph)
        self.assertIn("lt(t,1.0000)", graph)
        self.assertNotIn("2.0000", graph)

    def test_frame_rate_comes_from_the_stamps(self):
        with tempfile.TemporaryDirectory() as directory:
            for index in range(20):
                open(os.path.join(directory, f"{1_700_000_000_000 + index * 16}.png"), "wb").close()
            self.assertAlmostEqual(camera.frame_rate(directory), 62.5, places=1)


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

    def test_start_trims_the_take(self):
        take = self.path("take.mp4")
        make_take(take, (2560, 1600), (0.5, 0.5), seconds=3.0)
        out = self.path("start.mp4")
        run("--input", take, "--out", out, "--start", "1", "--keys", "0:1.0", "1:1.2")
        self.assertEqual(int(stream(out)["nb_read_frames"]), 60)


if __name__ == "__main__":
    unittest.main()
