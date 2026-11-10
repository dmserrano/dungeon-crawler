import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyReplayFile } from "../src/cli/replay";
import { buildIssueUrl } from "../src/debug/bug-report";
import { installErrorCapture } from "../src/debug/error-capture";
import { createLogger } from "../src/debug/logger";

const info = {
  repo: "o/r",
  simVersion: 4,
  seed: 42,
  tick: 120,
  hash: "abcd1234",
  userAgent: "UA/1.0 (X11; Linux)",
  logLines: ["a", "b"],
};

describe("buildIssueUrl", () => {
  it("encodes fields and points at the bug-report form", () => {
    const u = new URL(buildIssueUrl({ ...info, logLines: ["x & y=z\nnew line", "ü"] }));
    expect(u.origin + u.pathname).toBe("https://github.com/o/r/issues/new");
    expect(u.searchParams.get("template")).toBe("bug-report.yml");
    expect(u.searchParams.get("version")).toBe("sim 4");
    expect(u.searchParams.get("seed")).toBe("42");
    expect(u.searchParams.get("tick")).toBe("120");
    expect(u.searchParams.get("hash")).toBe("abcd1234");
    expect(u.searchParams.get("user-agent")).toBe(info.userAgent);
    expect(u.searchParams.get("logs")).toBe("x & y=z\nnew line\nü");
  });

  it("keeps only the last 50 lines", () => {
    const lines = Array.from({ length: 80 }, (_, i) => `L${i}`);
    const logs = new URL(buildIssueUrl({ ...info, logLines: lines })).searchParams.get("logs");
    const got = (logs ?? "").split("\n");
    expect(got).toHaveLength(50);
    expect(got[0]).toBe("L30");
    expect(got[49]).toBe("L79");
  });

  it("truncates oldest lines first to fit the length cap", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `${i} ${"x".repeat(200)}`);
    const url = buildIssueUrl({ ...info, logLines: lines }, 3000);
    expect(url.length).toBeLessThanOrEqual(3000);
    const got = (new URL(url).searchParams.get("logs") ?? "").split("\n");
    expect(got.length).toBeGreaterThan(0);
    expect(got.length).toBeLessThan(50);
    expect(got.at(-1)?.startsWith("49 ")).toBe(true);
  });

  it("stays under 8000 characters by default even with huge lines", () => {
    const url = buildIssueUrl({ ...info, logLines: ["é".repeat(5000), "é".repeat(5000)] });
    expect(url.length).toBeLessThanOrEqual(8000);
  });

  it("truncates an oversized user agent as a last resort", () => {
    const url = buildIssueUrl({ ...info, userAgent: "u".repeat(5000), logLines: [] }, 1000);
    expect(url.length).toBeLessThanOrEqual(1000);
  });
});

describe("installErrorCapture", () => {
  it("logs errors and rejections with stack, and does not swallow them", () => {
    const log = createLogger({ capacity: 10 });
    const target = new EventTarget();
    const off = installErrorCapture(target, log);

    const err = new Error("boom");
    const ev = Object.assign(new Event("error", { cancelable: true }), {
      error: err,
      message: "boom",
      filename: "a.js",
      lineno: 1,
      colno: 2,
    });
    target.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);

    const rej = Object.assign(new Event("unhandledrejection", { cancelable: true }), {
      reason: new Error("nope"),
    });
    target.dispatchEvent(rej);
    expect(rej.defaultPrevented).toBe(false);

    const [a, b] = log.entries();
    expect(a?.level).toBe("error");
    expect(a?.msg).toContain("boom");
    expect(JSON.stringify(a?.data)).toContain("Error: boom");
    expect(b?.level).toBe("error");
    expect(b?.msg).toContain("nope");

    off();
    target.dispatchEvent(new Event("error"));
    expect(log.entries()).toHaveLength(2);
  });

  it("handles non-Error rejection reasons", () => {
    const log = createLogger({ capacity: 10 });
    const target = new EventTarget();
    installErrorCapture(target, log);
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: "str" }));
    expect(log.entries()[0]?.msg).toContain("str");
  });
});

describe("replay CLI with .txt extension", () => {
  it("accepts a replay saved with a .txt extension", async () => {
    const dir = mkdtempSync(join(tmpdir(), "replay-"));
    const dest = join(dir, "replay.txt");
    copyFileSync(join(__dirname, "fixtures", "replay.valid.json"), dest);
    expect((await verifyReplayFile(dest)).ok).toBe(true);
  });
});
