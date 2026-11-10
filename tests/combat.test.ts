import { beforeAll, describe, expect, it } from "vitest";
import playerJson from "../data/player.json";
import { ATTACK_TOTAL_TICKS, attackPhaseAt, queueDamage } from "../src/sim/combat";
import { DUMMY_DATA, parseDummyData } from "../src/sim/data/dummy";
import { PLAYER_DATA, parsePlayerData } from "../src/sim/data/player";
import { createEntity, entitiesById, query } from "../src/sim/ecs/world";
import { type InputFrame, NO_INPUT, quantizeAim } from "../src/sim/input-frame";
import { createRapierWorld, initPhysics } from "../src/sim/physics/rapier-world";
import { buildReplay, parseReplay, runReplay } from "../src/sim/replay";
import { DUMMY_START } from "../src/sim/room";
import { createSimState, hashSimState, type SimState, step } from "../src/sim/step";

const A = PLAYER_DATA.attack;
const SEED = 7;
const hold = (n: number, f: Partial<InputFrame>): InputFrame[] =>
  Array.from({ length: n }, () => ({ ...NO_INPUT, ...f }));

/** Steps a sim while recording the input log; `hurt` injects damage on the player. */
function session() {
  const world = createRapierWorld();
  let s: SimState = createSimState(world, SEED);
  const log: InputFrame[] = [];
  const playerEntityId = () => {
    for (const e of query(s.ecs, "player")) return e.id;
    throw new Error("no player");
  };
  return {
    get s() {
      return s;
    },
    log,
    go(frames: InputFrame[]) {
      for (const f of frames) {
        log.push(f);
        s = step(s, f);
      }
    },
    hurt(amount = 1) {
      queueDamage(s.events, playerEntityId(), amount);
    },
    dummy() {
      return entitiesById(s.ecs).find((e) => e.dummy);
    },
  };
}

/** Walk next to the dummy and return the aim that points at it. */
function approachDummy(t: ReturnType<typeof session>): number {
  for (let i = 0; i < 400; i++) {
    const { x, y } = t.s.player;
    const dx = DUMMY_START.x - x;
    const dy = DUMMY_START.y - y;
    if (Math.hypot(dx, dy) < 22) break;
    t.go([{ ...NO_INPUT, right: dx > 4, up: dy < -4, down: dy > 4, aim: quantizeAim(dx, dy) }]);
  }
  t.go(hold(40, {})); // settle
  return quantizeAim(DUMMY_START.x - t.s.player.x, DUMMY_START.y - t.s.player.y);
}

describe("attack phases", () => {
  it("uses the data-driven windup/active/recovery lengths", () => {
    expect([A.windupTicks, A.activeTicks, A.recoveryTicks]).toEqual([4, 6, 10]);
    const seq = Array.from({ length: ATTACK_TOTAL_TICKS + 1 }, (_, t) => attackPhaseAt(t));
    expect(seq.slice(0, 4)).toEqual(Array(4).fill("windup"));
    expect(seq.slice(4, 10)).toEqual(Array(6).fill("active"));
    expect(seq.slice(10, 20)).toEqual(Array(10).fill("recovery"));
    expect(seq[20]).toBeNull();
  });

  beforeAll(async () => {
    await initPhysics();
  });

  it("the sim walks through the phases tick by tick, then ends", () => {
    const t = session();
    const seen: (string | null)[] = [];
    for (let k = 0; k < ATTACK_TOTAL_TICKS + 2; k++) {
      t.go([{ ...NO_INPUT, attack: k === 0 }]);
      seen.push(t.s.player.attack);
    }
    // The snapshot after tick k shows the phase of the next tick (t = k + 1).
    for (let k = 0; k < ATTACK_TOTAL_TICKS; k++) expect(seen[k]).toBe(attackPhaseAt(k + 1));
    expect(seen[ATTACK_TOTAL_TICKS - 1]).toBeNull();
    expect(seen.at(-1)).toBeNull();
  });

  it("slows movement to the configured fraction during a swing", () => {
    const walk = session();
    walk.go(hold(30, { right: true }));
    const swing = session();
    swing.go(hold(30, { right: true, attack: true }));
    expect(walk.s.player.vx).toBeCloseTo(PLAYER_DATA.maxSpeed, 0);
    expect(swing.s.player.vx).toBeCloseTo(PLAYER_DATA.maxSpeed * A.moveScale, 0);
  });
});

describe("melee", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it("hits a target at most once per swing", () => {
    const t = session();
    const world = t.s.world;
    // A target without i-frames in front of the player: only the once-per-swing rule limits it.
    const body = world.createStaticCircle(t.s.player.x + 16, t.s.player.y, 6);
    const e = createEntity(t.s.ecs, {
      body,
      position: { x: t.s.player.x + 16, y: t.s.player.y },
      health: { hp: 10, max: 10, iframeTicks: 0 },
      radius: 6,
    });
    const swingOnce = () =>
      t.go([
        { ...NO_INPUT, attack: true, aim: 0 },
        ...hold(ATTACK_TOTAL_TICKS + A.hitstopTicks, {}),
      ]);
    swingOnce();
    expect(e.health?.hp).toBe(10 - A.damage);
    // A second swing hits it again.
    swingOnce();
    expect(e.health?.hp).toBe(10 - 2 * A.damage);
  });

  it("misses a target behind the player", () => {
    const t = session();
    t.go([{ ...NO_INPUT, attack: true, aim: 128 }, ...hold(ATTACK_TOTAL_TICKS, {})]);
    expect(t.dummy()?.health?.hp).toBe(DUMMY_DATA.hp);
  });

  it("freezes both parties for the hitstop, then knocks the target away", () => {
    const t = session();
    const { x, y } = t.s.player;
    const body = t.s.world.createDynamicCircle(x + 16, y, 6);
    const e = createEntity(t.s.ecs, {
      body,
      position: { x: x + 16, y },
      health: { hp: 5, max: 5, iframeTicks: 0 },
      radius: 6,
    });
    const frozen: number[] = [];
    const xs: number[] = [];
    t.go([{ ...NO_INPUT, attack: true, aim: 0 }]);
    for (let i = 0; i < A.windupTicks + 20; i++) {
      t.go([NO_INPUT]);
      frozen.push(t.s.player.frozen);
      xs.push(e.position?.x ?? 0);
    }
    const hitAt = frozen.findIndex((f) => f > 0);
    expect(frozen.slice(hitAt, hitAt + 4)).toEqual([3, 2, 1, 0]);
    // Target does not move during hitstop, and is pushed along +x afterwards.
    const start = xs[hitAt - 1] ?? 0;
    for (let i = hitAt; i < hitAt + 4; i++) expect(xs[i]).toBe(start);
    expect(xs.at(-1)).toBeGreaterThan(start + 5);
    expect(e.health?.hp).toBe(5 - A.damage);
  });

  it("does not move a static dummy", () => {
    const t = session();
    const aim = approachDummy(t);
    t.go([{ ...NO_INPUT, attack: true, aim }, ...hold(ATTACK_TOTAL_TICKS, {})]);
    expect(t.dummy()?.health?.hp).toBe(DUMMY_DATA.hp - A.damage);
    expect(t.dummy()?.position).toEqual(DUMMY_START);
  });
});

describe("scenario replays", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it("(a) swings hit the dummy once each; it dies after N hits", () => {
    const t = session();
    const aim = approachDummy(t);
    const swing = [
      { ...NO_INPUT, attack: true, aim },
      ...hold(DUMMY_DATA.invulnTicks + 10, { aim }),
    ];
    for (let hit = 1; hit <= DUMMY_DATA.hp; hit++) {
      t.go(swing);
      if (hit < DUMMY_DATA.hp) expect(t.dummy()?.health?.hp).toBe(DUMMY_DATA.hp - hit);
    }
    expect(t.dummy()).toBeUndefined();
    expect(t.s.world.bodyCount()).toBe(5); // 4 walls + player
    expect(t.s.player.dead).toBe(false);

    const replay = buildReplay(SEED, t.log, t.s);
    const again = runReplay(parseReplay(JSON.parse(JSON.stringify(replay))), createRapierWorld());
    expect(hashSimState(again)).toBe(hashSimState(t.s));
    expect(hashSimState(t.s)).toBe(DUMMY_KILL_HASH);
  });

  it("(a) back-to-back swings inside the dummy's i-frames only land every other swing", () => {
    const t = session();
    const aim = approachDummy(t);
    t.go(hold(ATTACK_TOTAL_TICKS * 2 + 1, { attack: true, aim }));
    // Swing 1 lands at its tick 4; swing 2 starts at 20 and is active at 24-29, inside 30 i-frames.
    expect(t.dummy()?.health?.hp).toBe(DUMMY_DATA.hp - 1);
  });

  it("(b) dash i-frames prevent damage", () => {
    const t = session();
    const run = () => {
      const u = session();
      u.go([{ ...NO_INPUT, right: true, dash: true }]);
      u.hurt();
      u.go(hold(PLAYER_DATA.dash.iframeTicks - 2, { right: true })); // still inside the i-frames
      expect(u.s.player.hp).toBe(PLAYER_DATA.hp);
      u.go(hold(PLAYER_DATA.dash.ticks, { right: true })); // dash over, i-frames over
      u.hurt();
      u.go([NO_INPUT]);
      expect(u.s.player.hp).toBe(PLAYER_DATA.hp - 1);
      return u;
    };
    const u = run();
    expect(hashSimState(u.s)).toBe(hashSimState(run().s));
    expect(t.s.player.hp).toBe(PLAYER_DATA.hp);
  });

  it("(c) the invulnerability window prevents double damage", () => {
    const u = session();
    u.hurt();
    u.go([NO_INPUT]);
    expect(u.s.player.hp).toBe(PLAYER_DATA.hp - 1);
    expect(u.s.player.invulnerable).toBe(true);
    for (let i = 0; i < PLAYER_DATA.invulnTicks - 2; i++) {
      u.hurt();
      u.go([NO_INPUT]);
    }
    expect(u.s.player.hp).toBe(PLAYER_DATA.hp - 1);
    u.go(hold(3, {})); // window over
    expect(u.s.player.invulnerable).toBe(false);
    u.hurt();
    u.go([NO_INPUT]);
    expect(u.s.player.hp).toBe(PLAYER_DATA.hp - 2);
  });

  it("player death stops the sim", () => {
    const u = session();
    for (let i = 0; i < PLAYER_DATA.hp; i++) {
      u.hurt();
      u.go(hold(PLAYER_DATA.invulnTicks + 1, {}));
    }
    expect(u.s.player.hp).toBe(0);
    expect(u.s.player.dead).toBe(true);
    const frozenState = u.s;
    u.go(hold(10, { right: true }));
    expect(u.s.tick).toBe(frozenState.tick);
    expect(hashSimState(u.s)).toBe(hashSimState(frozenState));
  });
});

describe("combat data", () => {
  it.each([
    ["non-integer hp", { radius: 8, hp: 1.5, invulnTicks: 0 }],
    ["missing radius", { hp: 3, invulnTicks: 0 }],
    ["unknown key", { ...DUMMY_DATA, extra: 1 }],
  ])("rejects dummy data with %s", (_n, raw) => {
    expect(() => parseDummyData(raw)).toThrow(/invalid data\/dummy\.json/);
  });

  it.each([
    ["missing attack", { ...playerJson, attack: undefined }],
    ["zero hp", { ...playerJson, hp: 0 }],
    ["fractional damage", { ...playerJson, attack: { ...A, damage: 0.5 } }],
    ["move scale above 1", { ...playerJson, attack: { ...A, moveScale: 1.5 } }],
    ["zero active ticks", { ...playerJson, attack: { ...A, activeTicks: 0 } }],
  ])("rejects %s", (_n, raw) => {
    expect(() => parsePlayerData(raw)).toThrow(/invalid data\/player\.json/);
  });
});

const DUMMY_KILL_HASH = "186f5be9";
