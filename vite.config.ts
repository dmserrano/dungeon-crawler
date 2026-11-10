import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages serves project sites from /<repo>/. The deploy workflow sets VITE_BASE.
  base: process.env["VITE_BASE"] ?? "/",
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/sim/**"],
      exclude: ["src/sim/**/*.test.ts"],
      reporter: ["text-summary", "text"],
      // Gate for src/sim only. Raise as coverage grows; never go below 80% lines.
      thresholds: { lines: 80 },
    },
  },
});
