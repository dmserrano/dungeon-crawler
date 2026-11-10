import { defineConfig } from "vitest/config";

export default defineConfig({
  // GitHub Pages serves project sites from /<repo>/. The deploy workflow sets VITE_BASE.
  base: process.env["VITE_BASE"] ?? "/",
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    environment: "node",
  },
});
