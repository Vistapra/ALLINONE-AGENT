import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./tests/setup.ts",
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    // Reference hardware for this project can be a low-core-count machine (e.g. a 4-thread
    // Pentium) where jsdom-environment creation across many parallel workers causes real
    // CPU/IO contention, occasionally timing out setTimeout-based waitFor() assertions in
    // unrelated test files under full-suite load (confirmed: those same tests pass reliably
    // 100% of the time when run in isolation). Capping worker concurrency trades some wall
    // clock time for reliability on constrained hardware; raise this back up on stronger CI.
    pool: "threads",
    maxWorkers: 2,
  },
});
