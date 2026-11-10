// Compare two bench JSON files (base vs head) and print a markdown table.
// Warn-only: regressions over the threshold emit a ::warning annotation; always exits 0.
//   node bench/compare.mjs base.json head.json [thresholdPercent=25]
import { readFileSync } from "node:fs";

const [basePath, headPath, thr] = process.argv.slice(2);
if (!basePath || !headPath) {
  console.error("usage: compare.mjs base.json head.json [thresholdPercent]");
  process.exit(2);
}
const threshold = Number(thr ?? 25);
const load = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return [];
  }
};
const base = new Map(load(basePath).map((r) => [r.name, r]));
const head = load(headPath);

const lines = [
  "<!-- sim-bench -->",
  "### Sim benchmark (median ms/tick, lower is better)",
  "",
  "| case | base | head | change |",
  "| --- | ---: | ---: | ---: |",
];
const regressions = [];
for (const h of head) {
  const b = base.get(h.name);
  if (!b) {
    lines.push(`| ${h.name} | n/a | ${h.medianMs.toFixed(4)} | new |`);
    continue;
  }
  const pct = ((h.medianMs - b.medianMs) / b.medianMs) * 100;
  const flag = pct > threshold ? " ⚠️" : "";
  const sign = pct >= 0 ? "+" : "";
  lines.push(
    `| ${h.name} | ${b.medianMs.toFixed(4)} | ${h.medianMs.toFixed(4)} | ${sign}${pct.toFixed(1)}%${flag} |`,
  );
  if (pct > threshold) regressions.push(`${h.name} ${sign}${pct.toFixed(1)}%`);
}
lines.push("", `Warn-only; threshold ${threshold}%. Shared runners are noisy.`);
console.log(lines.join("\n"));
if (regressions.length > 0) {
  console.log(
    `::warning title=Sim benchmark regression::${regressions.join(", ")} (over ${threshold}%)`,
  );
}
