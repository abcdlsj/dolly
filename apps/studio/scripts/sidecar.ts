// Copies the compiled `dolly` binary (`bun run build:cli` at the repo root)
// and, on macOS, the Swift `dolly-driver` into src-tauri/binaries under the
// target triple Tauri wants. Both land next to the app executable, which is
// where `dolly` looks for its driver: without it `dolly trust` cannot answer,
// and the Accessibility row of the onboarding never turns green.

import { copyFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
const host = Bun.spawnSync(["rustc", "-vV"]).stdout.toString().match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error("rustc -vV printed no host triple");
const target = process.env.TAURI_ENV_TARGET_TRIPLE ?? host;
const extension = target.includes("windows") ? ".exe" : "";
const binaries = join(import.meta.dir, "..", "src-tauri", "binaries");

function copy(from: string, name: string): void {
  const to = join(binaries, `${name}-${target}${extension}`);
  copyFileSync(from, to);
  chmodSync(to, 0o755);
  console.log(`sidecar: ${to}`);
}

copy(join(root, ".build", `dolly${extension}`), "dolly");

const driver = join(root, "drivers", "macos", ".build", "release", `dolly-driver${extension}`);
if (process.platform === "win32") {
  // Other platforms get their own driver; only macOS has one today.
} else if (existsSync(driver)) {
  copy(driver, "dolly-driver");
} else {
  throw new Error(`no driver at ${driver}; run: swift build -c release --package-path drivers/macos`);
}
