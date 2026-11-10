import type { InputFrame } from "./input-frame";
import type { PhysicsWorld } from "./physics/physics-world";
import { createSimState, hashSimState, type SimState, step } from "./step";

/**
 * Bump whenever sim behavior changes in a way that alters state hashes (movement constants,
 * physics settings, new systems, room layout). Old replays are then rejected instead of
 * silently diverging.
 */
export const SIM_VERSION = 2;

/**
 * Run-length encoded input: `[mask, aim, count]`. Mask bits: up=1 down=2 left=4 right=8
 * attack=16 dash=32. `aim` is 0-255. A new run starts whenever mask or aim changes.
 */
export type InputRun = readonly [mask: number, aim: number, count: number];

export interface Replay {
  /** Replay file format version. */
  readonly version: 2;
  readonly simVersion: number;
  readonly seed: number;
  readonly ticks: number;
  readonly inputs: readonly InputRun[];
  readonly finalHash: string;
}

class ReplayError extends Error {}

const MAX_MASK = 0b111111;
const MAX_AIM = 255;

function toMask(f: InputFrame): number {
  return (
    (f.up ? 1 : 0) |
    (f.down ? 2 : 0) |
    (f.left ? 4 : 0) |
    (f.right ? 8 : 0) |
    (f.attack ? 16 : 0) |
    (f.dash ? 32 : 0)
  );
}

function fromMask(m: number, aim: number): InputFrame {
  return {
    up: (m & 1) !== 0,
    down: (m & 2) !== 0,
    left: (m & 4) !== 0,
    right: (m & 8) !== 0,
    aim,
    attack: (m & 16) !== 0,
    dash: (m & 32) !== 0,
  };
}

export function encodeInputs(frames: readonly InputFrame[]): InputRun[] {
  const runs: [number, number, number][] = [];
  for (const f of frames) {
    const m = toMask(f);
    const last = runs[runs.length - 1];
    if (last && last[0] === m && last[1] === f.aim) last[2]++;
    else runs.push([m, f.aim, 1]);
  }
  return runs;
}

export function decodeInputs(runs: readonly InputRun[]): InputFrame[] {
  return runs.flatMap(([m, a, n]) => Array.from({ length: n }, () => fromMask(m, a)));
}

function isUint(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

/** Validate untrusted JSON as a Replay. Throws `ReplayError` with a specific reason. */
export function parseReplay(raw: unknown): Replay {
  if (typeof raw !== "object" || raw === null) throw new ReplayError("replay must be an object");
  const r = raw as Record<string, unknown>;
  if (r.version === 1) {
    throw new ReplayError(
      "replay format changed: version 1 files are no longer supported (input runs now carry aim); re-record with this build",
    );
  }
  if (r.version !== 2) throw new ReplayError(`unsupported replay version: ${r.version}`);
  if (r.simVersion !== SIM_VERSION) {
    throw new ReplayError(`replay is for sim ${r.simVersion}, this build is ${SIM_VERSION}`);
  }
  if (!isUint(r.seed)) throw new ReplayError("seed must be a non-negative integer");
  if (!isUint(r.ticks)) throw new ReplayError("ticks must be a non-negative integer");
  if (typeof r.finalHash !== "string") throw new ReplayError("finalHash must be a string");
  const inputs = r.inputs;
  if (!Array.isArray(inputs)) throw new ReplayError("inputs must be an array");
  let total = 0;
  const runs: InputRun[] = [];
  for (const run of inputs) {
    if (!Array.isArray(run) || run.length !== 3) {
      throw new ReplayError("input run must be [mask, aim, count]");
    }
    const [mask, aim, count] = run as unknown[];
    if (!isUint(mask) || mask > MAX_MASK) throw new ReplayError("input run has an invalid mask");
    if (!isUint(aim) || aim > MAX_AIM) throw new ReplayError("input run has an invalid aim");
    if (!isUint(count) || count === 0) throw new ReplayError("input run has an invalid count");
    total += count;
    runs.push([mask, aim, count]);
  }
  if (total !== r.ticks) throw new ReplayError(`ticks (${r.ticks}) != input length (${total})`);
  return {
    version: 2,
    simVersion: r.simVersion,
    seed: r.seed,
    ticks: r.ticks,
    inputs: runs,
    finalHash: r.finalHash,
  };
}

export function buildReplay(
  seed: number,
  frames: readonly InputFrame[],
  finalState: SimState,
): Replay {
  return {
    version: 2,
    simVersion: SIM_VERSION,
    seed,
    ticks: frames.length,
    inputs: encodeInputs(frames),
    finalHash: hashSimState(finalState),
  };
}

/**
 * Re-simulate a replay on a fresh, empty physics world and return the final state.
 * Throws `ReplayError` if the final hash differs from the recorded one.
 */
export function runReplay(replay: Replay, world: PhysicsWorld): SimState {
  let state = createSimState(world, replay.seed);
  for (const frame of decodeInputs(replay.inputs)) state = step(state, frame);
  const hash = hashSimState(state);
  if (hash !== replay.finalHash) {
    throw new ReplayError(`final hash mismatch: expected ${replay.finalHash}, got ${hash}`);
  }
  return state;
}
