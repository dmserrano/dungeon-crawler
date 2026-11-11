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
import { ARENA, ARENA_FLOOR, ARENA_ROOMS } from "./arena";

const hold = (n: number, f: Partial<InputFrame>): InputFrame[] =>
  Array.from({ length: n }, () => ({ ...NO_INPUT, ...f }));

// Same log and hash as tests/replay.walking-skeleton.test.ts.
const LOG: InputFrame[] = [
  ...hold(120, { right: true }),
  ...hold(120, { down: true }),
  ...hold(30, {}),
];
const SEED = 1234;
const SKELETON_HASH = "1523ceb4";

describe("input encoding", () => {
  it("round-trips losslessly, including aim and buttons", () => {
    const mixed: InputFrame[] = [
      ...hold(3, { up: true, left: true, aim: 17 }),
      ...hold(1, {}),
      ...hold(5, { right: true, attack: true, aim: 255 }),
      ...hold(2, { up: true, down: true, left: true, right: true, attack: true, dash: true }),
      ...hold(4, { dash: true, aim: 128 }),
    ];
    expect(decodeInputs(encodeInputs(mixed))).toEqual(mixed);
  });

  it("run-length encodes repeated frames", () => {
    expect(encodeInputs(LOG)).toEqual([
      [8, 0, 120],
      [2, 0, 120],
      [0, 0, 30],
    ]);
  });

  it("starts a new run when only aim changes", () => {
    expect(encodeInputs([...hold(2, { aim: 1 }), ...hold(1, { aim: 2 })])).toEqual([
      [0, 1, 2],
      [0, 2, 1],
    ]);
  });

  it("encodes attack=16 and dash=32", () => {
    expect(encodeInputs(hold(1, { attack: true, dash: true }))).toEqual([[48, 0, 1]]);
  });

  it("handles an empty log", () => {
    expect(decodeInputs(encodeInputs([]))).toEqual([]);
  });
});

describe("parseReplay", () => {
  const valid: Replay = {
    version: 3,
    simVersion: SIM_VERSION,
    floor: "test-arena",
    seed: 7,
    ticks: 4,
    inputs: [[0, 0, 4]],
    finalHash: "00000000",
  };

  it("accepts a valid replay", () => {
    expect(parseReplay(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
  });

  it("rejects version 1 files saying the format changed", () => {
    const v1 = { ...valid, version: 1, simVersion: 1, inputs: [[0, 4]] };
    expect(() => parseReplay(v1)).toThrow(/format changed/);
  });

  it("rejects version 2 files saying the format changed", () => {
    const { floor: _floor, ...rest } = valid;
    expect(() => parseReplay({ ...rest, version: 2 })).toThrow(/format changed/);
  });

  it.each([
    ["non-object", 42],
    ["unknown version", { ...valid, version: 4 }],
    ["missing floor", { ...valid, floor: undefined }],
    ["floor that is a path", { ...valid, floor: "../x" }],
    ["old pair-shaped run", { ...valid, inputs: [[0, 4]] }],
    ["aim out of range", { ...valid, inputs: [[0, 256, 4]] }],
    ["negative aim", { ...valid, inputs: [[0, -1, 4]] }],
    ["wrong simVersion", { ...valid, simVersion: SIM_VERSION + 1 }],
    ["bad seed", { ...valid, seed: "x" }],
    ["inputs not an array", { ...valid, inputs: "no" }],
    ["bad run", { ...valid, inputs: [[99, 0, 1]] }],
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
      version: 3,
      simVersion: SIM_VERSION,
      floor: ARENA_FLOOR.id,
      seed: SEED,
      ticks: LOG.length,
      inputs: encodeInputs(LOG),
      finalHash: SKELETON_HASH,
    };
    const final = runReplay(replay, createRapierWorld(), ARENA_FLOOR, ARENA_ROOMS);
    expect(hashSimState(final)).toBe(SKELETON_HASH);
  });

  it("throws when the final hash does not match", () => {
    const replay: Replay = {
      version: 3,
      simVersion: SIM_VERSION,
      floor: ARENA_FLOOR.id,
      seed: SEED,
      ticks: LOG.length,
      inputs: encodeInputs(LOG),
      finalHash: "deadbeef",
    };
    expect(() => runReplay(replay, createRapierWorld(), ARENA_FLOOR, ARENA_ROOMS)).toThrow(/hash/i);
    expect(() =>
      runReplay(replay, createRapierWorld(), { ...ARENA_FLOOR, id: "other" }, ARENA_ROOMS),
    ).toThrow(/floor/i);
  });

  it("a recorded session re-runs to its own finalHash", () => {
    const rec = createRecorder(ARENA_FLOOR.id);
    let s = createSimState(createRapierWorld(), SEED, ARENA);
    for (const f of LOG) {
      rec.record(f);
      s = step(s, f);
    }
    const replay = rec.build(s);
    expect(replay.ticks).toBe(LOG.length);
    expect(replay.finalHash).toBe(hashSimState(s));
    const again = runReplay(
      parseReplay(JSON.parse(JSON.stringify(replay))),
      createRapierWorld(),
      ARENA_FLOOR,
      ARENA_ROOMS,
    );
    expect(hashSimState(again)).toBe(replay.finalHash);
  });
});
