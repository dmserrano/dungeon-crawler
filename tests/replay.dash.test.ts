import { beforeAll, describe, expect, it } from "vitest";
import { PLAYER_DATA } from "../src/sim/data/player";
import { aimToDir, type InputFrame, NO_INPUT, quantizeAim } from "../src/sim/input-frame";
import { createRapierWorld, initPhysics } from "../src/sim/physics/rapier-world";
import { buildReplay, parseReplay, runReplay } from "../src/sim/replay";
import { PLAYER_RADIUS } from "../src/sim/room";
import { createSimState, hashSimState, type SimState, step } from "../src/sim/step";
import { ARENA, ARENA_FLOOR, ARENA_ROOMS, PLAYER_START, ROOM_WIDTH } from "./arena";

const { distance, ticks: DASH_TICKS, iframeTicks, cooldownTicks } = PLAYER_DATA.dash;
const hold = (n: number, f: Partial<InputFrame>): InputFrame[] =>
  Array.from({ length: n }, () => ({ ...NO_INPUT, ...f }));

const SEED = 99;

describe("aim quantization", () => {
  it.each([
    [1, 0, 0],
    [0, 1, 64], // +y is down on screen: a quarter turn clockwise
    [-1, 0, 128],
    [0, -1, 192],
    [1, 1, 32],
    [0, 0, 0],
  ])("(%d, %d) -> %d", (dx, dy, aim) => {
    expect(quantizeAim(dx, dy)).toBe(aim);
  });

  it("always yields an integer in 0..255", () => {
    for (let deg = 0; deg < 360; deg += 0.7) {
      const a = (deg * Math.PI) / 180;
      const q = quantizeAim(Math.cos(a) * 50, Math.sin(a) * 50);
      expect(Number.isInteger(q)).toBe(true);
      expect(q).toBeGreaterThanOrEqual(0);
      expect(q).toBeLessThanOrEqual(255);
    }
  });

  it("wraps just below a full turn back to 255/0", () => {
    expect(quantizeAim(1, -0.001)).toBe(0);
    expect(quantizeAim(1, -0.02)).toBe(255);
  });

  it("aimToDir returns unit vectors matching the step", () => {
    expect(aimToDir(0)).toEqual({ x: 1, y: 0 });
    expect(aimToDir(64).y).toBe(1);
    expect(aimToDir(256)).toEqual(aimToDir(0));
  });
});

describe("dash", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  const fresh = () => createSimState(createRapierWorld(), SEED, ARENA);
  const run = (s: SimState, frames: InputFrame[]) => {
    for (const f of frames) s = step(s, f);
    return s;
  };

  it("moves about the configured distance in the configured ticks, using aim when idle", () => {
    // No movement keys: dash toward aim 64 (down).
    let s = fresh();
    s = run(s, hold(DASH_TICKS, { dash: true, aim: 64 }));
    expect(s.player.x).toBeCloseTo(PLAYER_START.x, 1);
    expect(s.player.y - PLAYER_START.y).toBeCloseTo(distance, 0);
  });

  it("prefers movement input over aim", () => {
    let s = fresh();
    s = run(s, hold(DASH_TICKS, { dash: true, right: true, aim: 64 }));
    expect(s.player.x - PLAYER_START.x).toBeCloseTo(distance, 0);
    expect(s.player.y).toBeCloseTo(PLAYER_START.y, 1);
  });

  it("grants i-frames for the first ticks only", () => {
    let s = fresh();
    const flags: boolean[] = [];
    for (let i = 0; i < DASH_TICKS + 2; i++) {
      s = step(s, { ...NO_INPUT, right: true, dash: i === 0 });
      flags.push(s.player.invulnerable);
    }
    expect(flags.slice(0, iframeTicks).every(Boolean)).toBe(true);
    expect(flags.slice(iframeTicks).some(Boolean)).toBe(false);
    expect(s.player.dashing).toBe(false);
  });

  it("scenario: dash across the room, cooldown blocks a second dash, wall stops it", () => {
    let s = fresh();
    const log: InputFrame[] = [];
    const go = (frames: InputFrame[]) => {
      log.push(...frames);
      s = run(s, frames);
    };

    // Dash right (button held for one tick only).
    go(hold(1, { right: true, dash: true }));
    go(hold(DASH_TICKS - 1, { right: true }));
    expect(s.player.dashing).toBe(false);
    const afterFirst = s.player.x;
    expect(afterFirst - PLAYER_START.x).toBeGreaterThan(distance - 1);
    expect(s.player.dashCooldown).toBe(cooldownTicks - DASH_TICKS + 1);

    // Try again well inside the cooldown: nothing happens.
    go(hold(1, { dash: true }));
    expect(s.player.dashing).toBe(false);

    // Stand still until the 45-tick cooldown (counted from the dash start) has elapsed.
    const elapsed = log.length;
    go(hold(cooldownTicks - elapsed - 1, {}));
    expect(log).toHaveLength(cooldownTicks - 1);
    go(hold(1, { dash: true })); // tick 44 after the dash start: one tick too early
    expect(s.player.dashing).toBe(false);
    const stoppedX = s.player.x;
    expect(Math.abs(s.player.vx)).toBeLessThan(1);

    // Cooldown over: dash again, repeatedly, into the east wall.
    go(hold(1, { right: true, dash: true }));
    expect(s.player.dashing).toBe(true);
    for (let i = 0; i < 4; i++) {
      go(hold(cooldownTicks, { right: true, dash: true }));
    }
    go(hold(DASH_TICKS, {}));
    expect(s.player.x).toBeGreaterThan(stoppedX + distance - 1);
    expect(s.player.x).toBeLessThanOrEqual(ROOM_WIDTH - PLAYER_RADIUS + 0.5); // contact softness allows a sliver of overlap
    expect(s.player.x).toBeGreaterThan(ROOM_WIDTH - PLAYER_RADIUS - 2);

    // Deterministic, and the replay round-trips through the v2 format.
    const replay = buildReplay(ARENA_FLOOR.id, SEED, log, s);
    expect(replay.version).toBe(3);
    const again = runReplay(
      parseReplay(JSON.parse(JSON.stringify(replay))),
      createRapierWorld(),
      ARENA_FLOOR,
      ARENA_ROOMS,
    );
    expect(hashSimState(again)).toBe(hashSimState(s));
    expect(hashSimState(s)).toBe(EXPECTED_HASH);
  });
});

const EXPECTED_HASH = "ab9ccaf0";
