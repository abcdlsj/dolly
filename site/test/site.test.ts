// site/js/camera.js is generated from @dolly/core; it must not drift from it.

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

test("site/js/camera.js is built from the current core", async () => {
  const build = await Bun.build({ entrypoints: [join(ROOT, "site", "src", "camera.ts")], format: "iife" });
  expect(build.success).toBe(true);
  const fresh = await build.outputs[0]!.text();
  const committed = readFileSync(join(ROOT, "site", "js", "camera.js"), "utf8");
  expect(committed).toBe(fresh);
});
