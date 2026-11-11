import { beforeAll, describe, expect, it } from "vitest";
import { queueDamage } from "../src/sim/combat";
import type { RoomSource } from "../src/sim/floor";
import { type InputFrame, NO_INPUT } from "../src/sim/input-frame";
import { createRapierWorld, initPhysics } from "../src/sim/physics/rapier-world";
import { activeProjectiles, fireProjectile } from "../src/sim/projectile";
import { buildReplay, parseReplay, runReplay } from "../src/sim/replay";
import type { DoorSpawn, Point, Room } from "../src/sim/room";
import { TRANSITION_MIDPOINT, TRANSITION_TICKS, transitionFade } from "../src/sim/run";
import {
  createSimState,
  entityViews,
  hashSimState,
  type SimState,
  stateSnapshot,
  step,
} from "../src/sim/step";

const W = 200;
const H = 100;
const SEED = 5;
const PLAYER_ID = 1;

/** A plain 200x100 box room with the given doors, optional dummy, player start at (100, 50). */
function room(doors: DoorSpawn[], dummy: Point | null, start: Point = { x: 100, y: 50 }): Room {
  return {
    width: W,
    height: H,
    walls: [
      { x: W / 2, y: -8, hw: W / 2 + 16, hh: 8 },
      { x: W / 2, y: H + 8, hw: W / 2 + 16, hh: 8 },
      { x: -8, y: H / 2, hw: 8, hh: H / 2 },
      { x: W + 8, y: H / 2, hw: 8, hh: H / 2 },
    ],
    playerStart: start,
    dummy,
    enemies: [],
    doors,
  };
}

const east = (to: string): DoorSpawn => ({ name: "east", to, toDoor: "west", x: W, y: 50 });
const west = (to: string): DoorSpawn => ({ name: "west", to, toDoor: "east", x: 0, y: 50 });

const ROOMS: Record<string, Room> = {
  a: room([east("b")], { x: 40, y: 50 }),
  b: room([west("a")], { x: 160, y: 50 }),
  quiet: room([east("b")], null),
};
const rooms: RoomSource = (id) => {
  const r = ROOMS[id];
  if (!r) throw new Error(`unknown room ${id}`);
  return r;
};
const FLOOR = { id: "scenario", start: "a", rooms: ["a", "b", "quiet"] };

const frame = (f: Partial<InputFrame>): InputFrame => ({ ...NO_INPUT, ...f });
const LEFT = frame({ left: true, attack: true, aim: 128 });
const RIGHT = frame({ right: true, attack: true, aim: 0 });
const enemyCount = (s: SimState) => entityViews(s).filter((v) => !v.projectile).length;

describe("doors, transitions and the run record", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it("scenario: clear a room, walk through, lock and unlock, carry state, replay v3 verifies", () => {
    const world = createRapierWorld();
    let s = createSimState(world, SEED, ROOMS.a as Room, { roomId: "a", rooms });
    const log: InputFrame[] = [];
    const go = (f: InputFrame, stop: (s: SimState) => boolean, cap = 600) => {
      for (let i = 0; i < cap && !stop(s); i++) {
        log.push(f);
        s = step(s, f);
      }
      expect(stop(s)).toBe(true);
    };

    // Room a has a live dummy, so it starts locked: walking at the door does not leave.
    expect(s.locked).toBe(true);
    go(frame({ right: true }), (x) => x.player.x > 150, 300);
    for (let i = 0; i < 60; i++) {
      log.push(frame({ right: true }));
      s = step(s, log[log.length - 1] as InputFrame);
    }
    expect(s.transition).toBeNull();
    expect(s.roomId).toBe("a");
    expect(s.player.x).toBeLessThan(W - 6);

    // Kill the dummy: the room clears once, the doors unlock, the room joins the cleared set.
    go(LEFT, (x) => x.cleared);
    expect(s.locked).toBe(false);
    expect(s.clearedRooms).toEqual(["a"]);
    const hpBefore = s.player.hp;

    // Walk into the door: the transition starts, ignores input, swaps at the midpoint.
    go(frame({ right: true }), (x) => x.transition !== null);
    expect(s.transition?.to).toBe("b");
    expect(transitionFade(s.transition)).toBe(0);
    let sawMidpoint = false;
    while (s.transition) {
      const f = frame({ left: true, dash: true });
      log.push(f);
      s = step(s, f);
      const t = s.transition?.t ?? TRANSITION_TICKS;
      if (t === TRANSITION_MIDPOINT) {
        sawMidpoint = true;
        expect(transitionFade(s.transition)).toBe(1);
        expect(s.roomId).toBe("b");
        expect(enemyCount(s)).toBe(0); // enemies spawn only when the transition ends
        expect(s.player.x).toBeCloseTo(24, 0); // paired door (west, x=0), nudged inward
        expect(s.player.y).toBeCloseTo(50, 0);
      }
    }
    expect(sawMidpoint).toBe(true);
    expect(s.roomId).toBe("b");
    expect(enemyCount(s)).toBe(1);
    expect(s.locked).toBe(true); // including the door it came through
    expect(s.player.hp).toBe(hpBefore);

    // Locked in b: pushing at the door we entered through goes nowhere.
    for (let i = 0; i < 60; i++) {
      log.push(frame({ left: true }));
      s = step(s, log[log.length - 1] as InputFrame);
    }
    expect(s.roomId).toBe("b");
    expect(s.transition).toBeNull();

    go(RIGHT, (x) => x.cleared);
    expect(s.locked).toBe(false);
    expect(s.clearedRooms).toEqual(["a", "b"]);

    // Back through the open door: room a stays cleared, spawns nothing and stays open.
    go(frame({ left: true }), (x) => x.transition !== null);
    go(NO_INPUT, (x) => x.transition === null, TRANSITION_TICKS);
    expect(s.roomId).toBe("a");
    expect(enemyCount(s)).toBe(0);
    expect(s.cleared).toBe(true);
    expect(s.locked).toBe(false);
    expect(s.player.hp).toBe(hpBefore);

    // State hash: the run record is part of it.
    expect(stateSnapshot(s).run).toEqual({
      room: "a",
      cleared: ["a", "b"],
      locked: false,
      transition: null,
    });

    // Replay v3 names the floor and reproduces the whole run.
    const replay = buildReplay(FLOOR.id, SEED, log, s);
    expect(replay.version).toBe(3);
    expect(replay.floor).toBe("scenario");
    const again = runReplay(
      parseReplay(JSON.parse(JSON.stringify(replay))),
      createRapierWorld(),
      FLOOR,
      rooms,
    );
    expect(hashSimState(again)).toBe(hashSimState(s));
    expect(again.roomId).toBe("a");
  });

  it("carries HP and dash cooldown across (no heal) and discards projectiles", () => {
    const world = createRapierWorld();
    let s = createSimState(world, SEED, ROOMS.quiet as Room, { roomId: "quiet", rooms });
    expect(s.locked).toBe(false); // no enemies: never locks
    queueDamage(s.events, PLAYER_ID, 2);
    s = step(s, NO_INPUT);
    expect(s.player.hp).toBe(s.player.maxHp - 2);
    expect(fireProjectile(s.ecs, world, { x: 50, y: 20 }, 6, { x: 0, y: 1 })).toBe(true);
    expect(activeProjectiles(s.ecs)).toBe(1);

    for (let i = 0; i < 200 && !s.transition; i++) {
      s = step(s, frame({ right: true, dash: i === 0 }));
    }
    expect(s.transition).not.toBeNull();
    const before = s.player;
    expect(before.dashCooldown).toBeGreaterThan(0);
    while (s.transition) s = step(s, NO_INPUT);
    expect(activeProjectiles(s.ecs)).toBe(0);
    expect(s.player.hp).toBe(before.hp);
    expect(s.player.dashCooldown).toBe(before.dashCooldown);
    expect(s.roomId).toBe("b");
  });

  it("throws when the paired door does not exist", () => {
    const bad: Room = room([{ ...east("b"), toDoor: "nope" }], null);
    const world = createRapierWorld();
    let s = createSimState(world, SEED, bad, {
      roomId: "bad",
      rooms: (id) => (id === "bad" ? bad : rooms(id)),
    });
    expect(() => {
      for (let i = 0; i < 300; i++) s = step(s, frame({ right: true }));
    }).toThrow(/no door "nope"/);
  });

  it("a bare createSimState only knows its own room", () => {
    const s = createSimState(createRapierWorld(), SEED, ROOMS.a as Room);
    expect(() => s.rooms("elsewhere")).toThrow(/unknown room/);
    expect(s.rooms(s.roomId)).toBe(ROOMS.a);
  });
});
