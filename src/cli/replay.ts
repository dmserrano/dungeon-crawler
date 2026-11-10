import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createRapierWorld, initPhysics } from "../sim/physics/rapier-world";
import { parseReplay, runReplay } from "../sim/replay";

export interface VerifyResult {
  ok: boolean;
  reason?: string;
  ticks: number | null;
  expectedHash: string | null;
  actualHash: string | null;
}

const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Read, parse and re-simulate a replay file headless. Never throws. */
export async function verifyReplayFile(path: string): Promise<VerifyResult> {
  const fail = (reason: string, extra: Partial<VerifyResult> = {}): VerifyResult => ({
    ok: false,
    reason,
    ticks: null,
    expectedHash: null,
    actualHash: null,
    ...extra,
  });

  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    return fail(`unreadable file: ${msg(e)}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail(`invalid JSON: ${msg(e)}`);
  }
  let replay: ReturnType<typeof parseReplay>;
  try {
    replay = parseReplay(raw);
  } catch (e) {
    return fail(`rejected replay: ${msg(e)}`);
  }
  const base = { ticks: replay.ticks, expectedHash: replay.finalHash };
  try {
    await initPhysics();
    runReplay(replay, createRapierWorld());
  } catch (e) {
    const m = msg(e);
    const actual = /got (\S+)$/.exec(m)?.[1] ?? null;
    return fail(m, { ...base, actualHash: actual });
  }
  return { ok: true, ...base, actualHash: replay.finalHash };
}

export async function main(argv: readonly string[]): Promise<number> {
  const json = argv.includes("--json");
  const files = argv.filter((a) => a !== "--json");
  const file = files[0];
  if (files.length !== 1 || file === undefined || file.startsWith("-")) {
    console.error("usage: pnpm replay [--json] <replay.json>");
    return 2;
  }
  const result = await verifyReplayFile(file);
  if (json) {
    console.log(JSON.stringify(result));
  } else if (result.ok) {
    console.log(`OK ticks=${result.ticks} hash=${result.actualHash}`);
  } else {
    console.error(`FAIL ${result.reason}`);
  }
  return result.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
