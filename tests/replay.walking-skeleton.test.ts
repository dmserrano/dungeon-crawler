import { beforeAll, describe, expect, it } from "vitest";
import { type InputFrame, NO_INPUT } from "../src/sim/input-frame";
import { createRapierWorld, initPhysics } from "../src/sim/physics/rapier-world";
import { PLAYER_RADIUS, ROOM_HEIGHT, ROOM_WIDTH } from "../src/sim/room";
import { createSimState, hashSimState, step } from "../src/sim/step";

const hold = (n: number, f: Partial<InputFrame>): InputFrame[] =>
  Array.from({ length: n }, () => ({ ...NO_INPUT, ...f }));

// Hold right into the east wall, then down into the south wall, then coast.
const LOG: InputFrame[] = [
  ...hold(120, { right: true }),
  ...hold(120, { down: true }),
  ...hold(30, {}),
];

// Re-recorded for sim v4: the room also holds two chasers, which stay idle here because the
// player never comes within their aggro range (movement is unchanged).
const EXPECTED_HASH = "290f1edc";

function run(seed: number, log: InputFrame[]) {
  let s = createSimState(createRapierWorld(), seed);
  for (const f of log) s = step(s, f);
  return s;
}

describe("replay: walking skeleton", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it("ends stopped against the walls", () => {
    const s = run(1234, LOG);
    expect(s.player.x).toBeCloseTo(ROOM_WIDTH - PLAYER_RADIUS, 1);
    expect(s.player.y).toBeCloseTo(ROOM_HEIGHT - PLAYER_RADIUS, 1);
    expect(Math.hypot(s.player.vx, s.player.vy)).toBeLessThan(0.01);
  });

  it("is deterministic and matches the recorded hash", () => {
    const a = hashSimState(run(1234, LOG));
    const b = hashSimState(run(1234, LOG));
    expect(a).toBe(b);
    expect(a).toBe(EXPECTED_HASH);
  });
});
