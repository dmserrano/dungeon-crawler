import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main, verifyReplayFile } from "../src/cli/replay";

const fx = (n: string) => join(__dirname, "fixtures", n);

describe("verifyReplayFile", () => {
  it("verifies a valid replay", async () => {
    const r = await verifyReplayFile(fx("replay.valid.json"));
    expect(r).toEqual({ ok: true, ticks: 270, expectedHash: "acadead2", actualHash: "acadead2" });
  });

  it("reports a hash mismatch with both hashes", async () => {
    const r = await verifyReplayFile(fx("replay.wrong-hash.json"));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/final hash mismatch/);
    expect(r.expectedHash).toBe("deadbeef");
    expect(r.actualHash).toBe("acadead2");
  });

  it("rejects a version 1 replay saying the format changed", async () => {
    const r = await verifyReplayFile(fx("replay.v1.json"));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/format changed/);
  });

  it("reports a wrong simVersion", async () => {
    const r = await verifyReplayFile(fx("replay.wrong-sim-version.json"));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/rejected replay: .*sim/);
  });

  it("reports invalid JSON", async () => {
    const r = await verifyReplayFile(fx("replay.malformed.txt"));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^invalid JSON/);
  });

  it("reports an unreadable file", async () => {
    const r = await verifyReplayFile(fx("does-not-exist.json"));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^unreadable file/);
  });
});

describe("main", () => {
  it("returns 2 on bad usage", async () => {
    expect(await main([])).toBe(2);
  });
});

describe("pnpm replay (end to end)", () => {
  const run = (...args: string[]) =>
    spawnSync("pnpm", ["--silent", "replay", ...args], { encoding: "utf8" });

  it("exits 0 and prints ticks and hash", () => {
    const p = run(fx("replay.valid.json"));
    expect(p.status).toBe(0);
    expect(p.stdout).toContain("ticks=270");
    expect(p.stdout).toContain("hash=acadead2");
  });

  it("exits non-zero with --json on mismatch", () => {
    const p = run("--json", fx("replay.wrong-hash.json"));
    expect(p.status).toBe(1);
    expect(JSON.parse(p.stdout)).toMatchObject({ ok: false, expectedHash: "deadbeef" });
  });
});
