import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Mechanical enforcement of SPEC.md section 4: sim/ is headless and deterministic.
 * Agents erode soft rules, so this fails CI instead.
 */
const SIM_DIR = join(import.meta.dirname, "..", "src", "sim");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sourceFiles(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

const FORBIDDEN_IMPORTS = [
  /from\s+["']pixi\.js["']/,
  /from\s+["']preact/,
  /from\s+["'](\.\.\/)+(render|ui|input|audio|debug|game)\b/,
];
const FORBIDDEN_CALLS = [
  /Math\.random\s*\(/,
  /Date\.now\s*\(/,
  /performance\.now\s*\(/,
  /\bdocument\./,
  /\bwindow\./,
];

describe("sim/ boundary", () => {
  const files = sourceFiles(SIM_DIR);

  it("finds sim files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file.slice(SIM_DIR.length + 1)} is headless and deterministic`, () => {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const re of [...FORBIDDEN_IMPORTS, ...FORBIDDEN_CALLS]) {
        expect(code, `${file} matches ${re}`).not.toMatch(re);
      }
    });
  }
});
