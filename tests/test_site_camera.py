"""site/js/camera.js against scripts/camera.py: the same shots must plan the same.

The onboarding page animates its moves with a port of the planner; this keeps
the two in step. Needs node and skips without it.
"""

from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("camera", os.path.join(ROOT, "scripts", "camera.py"))
camera = importlib.util.module_from_spec(spec)
sys.modules["camera"] = camera
spec.loader.exec_module(camera)

NODE = shutil.which("node")
SAMPLES = [0.0, 0.5, 1.3, 2.7, 4.1, 5.6, 6.2, 8.0, 9.5]

# Runs camera.js under node and prints, per case, what the Python side computes below.
RUNNER = """
global.window = globalThis;
require(process.argv[1]);
const cases = JSON.parse(process.argv[2]);
const samples = JSON.parse(process.argv[3]);
console.log(JSON.stringify(cases.map((c) => {
  const s = DollyCamera.shot(c);
  const e = s.explain();
  return {
    ceiling: e.ceiling, keys: e.keys, warnings: e.warnings,
    peak_pan: e.peak_pan, peak_zoom_rate: e.peak_zoom_rate,
    views: samples.map((t) => s.camera.view(t)),
  };
})));
"""

CASES = [
    {
        "source": [3200, 1800], "length": 10,
        "beats": [
            {"move": "hold", "for": 0.6},
            {"move": "focus", "at": 1.9, "point": [0.586, 0.262], "zoom": 1.5, "for": 1.6},
            {"move": "pan-to", "at": 3.6, "point": [0.858, 0.498], "for": 1.6},
            {"move": "punch-in", "at": 5.5, "amount": 1.1},
            {"move": "pull-back", "at": 7.2, "for": 1.8},
        ],
    },
    {
        "source": [2880, 1800], "length": 10, "aspect": "9:16", "fit": "crop",
        "beats": [
            {"move": "focus", "at": 0.4, "rect": [0.4, 0.2, 0.25, 0.1], "fill": 0.6},
            {"move": "tour", "stops": [[0.1, 0.1], {"rect": [0.5, 0.5, 0.1, 0.1]}], "zoom": 1.3},
            {"move": "drift", "for": 1},
            {"move": "frame", "point": [0.2, 0.3], "ease": "smooth"},
        ],
    },
    {
        "source": [2560, 1600], "length": 12, "aspect": "4:5",
        "beats": [
            {"move": "hold", "for": 0.5},
            {"move": "frame", "point": [0.3, 0.6], "zoom": 2.2, "ease": "out"},
            {"move": "drift", "at": "+0.4", "amount": 1.1},
            {"move": "pull-back", "at": "end-2", "ease": "linear"},
        ],
    },
]


def python_side(case: dict) -> dict:
    source = tuple(case["source"])
    fit = case.get("fit", "pad")
    out = camera.parse_aspect(case.get("aspect", "16:9"))
    length = float(case["length"])
    ceiling = camera.ceiling_for(source, fit, out)
    plan = camera.plan_shot({"beats": case["beats"]}, source, fit, ceiling, out, length)
    cam = camera.Camera.build(plan.keys, source, fit, ceiling, out)
    checks = camera.review(cam, plan.keys, plan.beats, length)
    warnings = list(plan.warnings)
    if camera.canvas(source, fit, out)[0] < out[0]:
        warnings.append(f"the canvas is narrower than {out[0]} px; text will be soft at any zoom")
    keys = [
        f"{k.t:.3f}:{round(min(max(k.zoom, 1.0), ceiling), 3):.3f}:{k.x:.3f}:{k.y:.3f}:{k.ease}" for k in plan.keys
    ]
    return {
        "ceiling": ceiling, "keys": keys, "warnings": warnings + checks["warnings"],
        "peak_pan": checks["peak_pan"], "peak_zoom_rate": checks["peak_zoom_rate"],
        "views": [list(cam.view(t)) for t in SAMPLES],
    }


@unittest.skipIf(NODE is None, "needs node")
class SitePlannerMatches(unittest.TestCase):
    def test_same_plan(self) -> None:
        script = os.path.join(ROOT, "site", "js", "camera.js")
        result = subprocess.run(
            [NODE, "-e", RUNNER, script, json.dumps(CASES), json.dumps(SAMPLES)],
            check=True, capture_output=True, text=True,
        )
        for case, js in zip(CASES, json.loads(result.stdout)):
            py = python_side(case)
            with self.subTest(source=case["source"], aspect=case.get("aspect", "16:9")):
                self.assertEqual(js["keys"], py["keys"])
                self.assertEqual(js["warnings"], py["warnings"])
                self.assertAlmostEqual(js["ceiling"], py["ceiling"])
                self.assertAlmostEqual(js["peak_pan"], py["peak_pan"], places=3)
                self.assertAlmostEqual(js["peak_zoom_rate"], py["peak_zoom_rate"], places=3)
                for a, b in zip(js["views"], py["views"]):
                    for u, v in zip(a, b):
                        self.assertAlmostEqual(u, v, places=6)


if __name__ == "__main__":
    unittest.main()
