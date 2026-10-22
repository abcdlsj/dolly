// Copies the compiled `dolly` binary (`bun run build:cli` at the repo root)
// to where Tauri bundles sidecars: src-tauri/binaries/dolly-<target triple>.

import { copyFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..", "..");
const host = Bun.spawnSync(["rustc", "-vV"]).stdout.toString().match(/^host: (.+)$/m)?.[1];
if (!host) throw new Error("rustc -vV printed no host triple");
const target = process.env.TAURI_ENV_TARGET_TRIPLE ?? host;
const extension = target.includes("windows") ? ".exe" : "";
const to = join(import.meta.dir, "..", "src-tauri", "binaries", `dolly-${target}${extension}`);
copyFileSync(join(root, ".build", `dolly${extension}`), to);
chmodSync(to, 0o755);
console.log(`sidecar: ${to}`);
