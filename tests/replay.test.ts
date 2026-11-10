import { beforeAll, describe, expect, it } from "vitest";
import { createRecorder } from "../src/debug/recorder";
import { type InputFrame, NO_INPUT } from "../src/sim/input-frame";
import { createRapierWorld, initPhysics } from "../src/sim/physics/rapier-world";
import {
  decodeInputs,
  encodeInputs,
  parseReplay,
  type Replay,
  runReplay,
  SIM_VERSION,
} from "../src/sim/replay";
import { createSimState, hashSimState, step } from "../src/sim/step";

const hold = (n: number, f: Partial<InputFrame>): InputFrame[] =>
  Array.from({ length: n }, () => ({ ...NO_INPUT, ...f }));

// Same log and hash as tests/replay.walking-skeleton.test.ts.
const LOG: InputFrame[] = [
  ...hold(120, { right: true }),
  ...hold(120, { down: true }),
  ...hold(30, {}),
];
const SEED = 1234;
const SKELETON_HASH = "dc9da512";

describe("input encoding", () => {
  it("round-trips losslessly", () => {
    const mixed: InputFrame[] = [
      ...hold(3, { up: true, left: true }),
      ...hold(1, {}),
      ...hold(5, { right: true }),
      ...hold(2, { up: true, down: true, left: true, right: true }),
    ];
    expect(decodeInputs(encodeInputs(mixed))).toEqual(mixed);
  });

  it("run-length encodes repeated frames", () => {
    expect(encodeInputs(LOG)).toHaveLength(3);
  });

  it("handles an empty log", () => {
    expect(decodeInputs(encodeInputs([]))).toEqual([]);
  });
});

describe("parseReplay", () => {
  const valid: Replay = {
    version: 1,
    simVersion: SIM_VERSION,
    seed: 7,
    ticks: 4,
    inputs: [[0, 4]],
    finalHash: "00000000",
  };

  it("accepts a valid replay", () => {
    expect(parseReplay(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it.each([
    ["non-object", 42],
    ["wrong version", { ...valid, version: 2 }],
    ["wrong simVersion", { ...valid, simVersion: SIM_VERSION + 1 }],
    ["bad seed", { ...valid, seed: "x" }],
    ["inputs not an array", { ...valid, inputs: "no" }],
    ["bad run", { ...valid, inputs: [[99, 1]] }],
    ["tick mismatch", { ...valid, ticks: 5 }],
    ["missing hash", { ...valid, finalHash: undefined }],
  ])("rejects %s", (_name, bad) => {
    expect(() => parseReplay(bad)).toThrow();
  });
});

describe("runReplay and recorder", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it("re-runs the walking-skeleton log to the recorded hash", () => {
    const replay: Replay = {
      version: 1,
      simVersion: SIM_VERSION,
      seed: SEED,
      ticks: LOG.length,
      inputs: encodeInputs(LOG),
      finalHash: SKELETON_HASH,
    };
    const final = runReplay(replay, createRapierWorld());
    expect(hashSimState(final)).toBe(SKELETON_HASH);
  });

  it("throws when the final hash does not match", () => {
    const replay: Replay = {
      version: 1,
      simVersion: SIM_VERSION,
      seed: SEED,
      ticks: LOG.length,
      inputs: encodeInputs(LOG),
      finalHash: "deadbeef",
    };
    expect(() => runReplay(replay, createRapierWorld())).toThrow(/hash/i);
  });

  it("a recorded session re-runs to its own finalHash", () => {
    const rec = createRecorder();
    let s = createSimState(createRapierWorld(), SEED);
    for (const f of LOG) {
      rec.record(f);
      s = step(s, f);
    }
    const replay = rec.build(s);
    expect(replay.ticks).toBe(LOG.length);
    expect(replay.finalHash).toBe(hashSimState(s));
    const again = runReplay(parseReplay(JSON.parse(JSON.stringify(replay))), createRapierWorld());
    expect(hashSimState(again)).toBe(replay.finalHash);
  });
});
