// Fails if the gzipped JS in dist/assets exceeds the budget.
// To raise the budget (e.g. after adding Pixi/Rapier features), change BUDGET_KB below.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

const BUDGET_KB = 1500;
const dir = join(import.meta.dirname, "..", "dist", "assets");

const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
if (files.length === 0) {
  console.error("No JS files in dist/assets. Run `pnpm build` first.");
  process.exit(1);
}
const bytes = files.reduce((sum, f) => sum + gzipSync(readFileSync(join(dir, f))).length, 0);
const kb = bytes / 1024;
console.log(`JS bundle (gzip): ${kb.toFixed(1)} KB / budget ${BUDGET_KB} KB`);
if (kb > BUDGET_KB) {
  console.error(
    "Bundle budget exceeded. Raise BUDGET_KB in scripts/check-bundle-size.mjs if intentional.",
  );
  process.exit(1);
}
