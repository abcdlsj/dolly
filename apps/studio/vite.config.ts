import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };

// The Go shell embeds dist/ and serves it over its own scheme.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: { __APP_VERSION__: JSON.stringify(version) },
  build: { target: "safari15", outDir: "dist" },
});
