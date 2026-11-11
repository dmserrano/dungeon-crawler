import { beforeAll, describe, expect, it } from "vitest";
import { enemiesDataSchema } from "../data/schemas/enemies";
import { describeProjectiles } from "../src/debug/stats";
import { type AiMemory, type AiSense, newAiMemory } from "../src/sim/ai/memory";
import { nextRangedState } from "../src/sim/ai/ranged";
import type { SimEvent } from "../src/sim/combat";
import { CHASER_DATA, parseEnemiesData, RANGED_DATA } from "../src/sim/data/enemies";
import { PLAYER_DATA } from "../src/sim/data/player";
import { createEcsWorld, entitiesById, query } from "../src/sim/ecs/world";
import { type InputFrame, NO_INPUT } from "../src/sim/input-frame";
import type { PhysicsWorld } from "../src/sim/physics/physics-world";
import { createRapierWorld, initPhysics } from "../src/sim/physics/rapier-world";
import {
  activeProjectiles,
  createProjectilePool,
  fireProjectile,
  projectileSystem,
} from "../src/sim/projectile";
import { buildReplay, parseReplay, runReplay } from "../src/sim/replay";
import { createSimState, entityViews, hashSimState, type SimState, step } from "../src/sim/step";
import { ARENA, ARENA_FLOOR, ARENA_ROOMS, RANGED_START } from "./arena";

const R = RANGED_DATA;
const P = R.projectile;
const SEED = 33;

describe("ranged enemy data", () => {
  it("loads data/enemies.json with the kiting, telegraph and projectile fields", () => {
    expect(R.telegraphTicks).toBe(12);
    expect(R.keepDistance.min).toBeLessThan(R.keepDistance.max);
    expect(P.speed).toBeGreaterThan(0);
    expect(P.lifetimeTicks).toBeGreaterThan(0);
  });

  it.each([
    ["no ranged entry", { chaser: CHASER_DATA }],
    ["unknown key", { chaser: CHASER_DATA, ranged: { ...R, extra: 1 } }],
    [
      "inverted keepDistance",
      { chaser: CHASER_DATA, ranged: { ...R, keepDistance: { min: 90, max: 80 } } },
    ],
    [
      "keepDistance beyond aggroRange",
      { chaser: CHASER_DATA, ranged: { ...R, keepDistance: { min: 10, max: R.aggroRange } } },
    ],
    [
      "fractional lifetime",
      { chaser: CHASER_DATA, ranged: { ...R, projectile: { ...P, lifetimeTicks: 1.5 } } },
    ],
    ["empty pool", { chaser: CHASER_DATA, ranged: { ...R, projectile: { ...P, poolSize: 0 } } }],
  ])("rejects %s", (_name, bad) => {
    expect(enemiesDataSchema.safeParse(bad).success).toBe(false);
    expect(() => parseEnemiesData(bad)).toThrow(/enemies\.json/);
  });
});

describe("ranged state machine (pure, from data)", () => {
  const sense = (dist: number, extra: Partial<AiSense> = {}): AiSense => ({
    dist,
    toPlayer: { x: 0, y: 1 },
    staggered: false,
    dead: false,
    ...extra,
  });
  const at = (state: AiMemory["state"], patch: Partial<AiMemory> = {}): AiMemory => ({
    ...newAiMemory(),
    state,
    ...patch,
  });

  it("idles until the player is in range, then kites", () => {
    expect(nextRangedState(newAiMemory(), sense(R.aggroRange + 1), R).state).toBe("idle");
    expect(nextRangedState(newAiMemory(), sense(R.aggroRange), R).state).toBe("kite");
  });

  it("telegraphs for exactly telegraphTicks, fires for one tick, then kites on cooldown", () => {
    let m = nextRangedState(at("kite"), sense(90), R);
    expect(m.state).toBe("telegraph");
    expect(m.dir).toEqual({ x: 0, y: 1 });
    const seq: string[] = [];
    for (let i = 0; i < R.telegraphTicks + 1; i++) {
      m = nextRangedState(m, sense(90, { toPlayer: { x: 1, y: 0 } }), R);
      seq.push(m.state);
    }
    expect(seq.filter((s) => s === "telegraph")).toHaveLength(R.telegraphTicks - 1);
    expect(seq[R.telegraphTicks - 1]).toBe("fire");
    expect(seq[R.telegraphTicks]).toBe("kite");
    expect(m.dir).toEqual({ x: 0, y: 1 }); // aim stayed locked
    expect(m.cooldown).toBe(R.fireIntervalTicks);
    expect(nextRangedState(m, sense(90), R).state).toBe("kite");
  });

  it("does not telegraph out of range or on cooldown", () => {
    expect(nextRangedState(at("kite"), sense(R.aggroRange + 1), R).state).toBe("kite");
    expect(nextRangedState(at("kite", { cooldown: 2 }), sense(90), R).state).toBe("kite");
  });

  it.each(["kite", "telegraph", "fire", "idle"] as const)(
    "a hit interrupts %s into stagger",
    (s) => {
      const m = nextRangedState(at(s, { t: 3 }), sense(90, { staggered: true }), R);
      expect(m.state).toBe("stagger");
      expect(m.t).toBe(0);
    },
  );

  it("stagger ends into kite with a cooldown; dead is terminal", () => {
    const hit = nextRangedState(at("kite"), sense(90, { staggered: true }), R);
    const m = nextRangedState(hit, sense(90), R);
    expect(m.state).toBe("kite");
    expect(m.cooldown).toBeGreaterThan(0);
    const dead = nextRangedState(at("kite"), sense(90, { dead: true }), R);
    expect(dead.state).toBe("dead");
    expect(nextRangedState(dead, sense(1), R)).toBe(dead);
  });
});

/** A world double for the pool: sensor bodies that move by velocity and overlap nothing. */
function stubWorld() {
  const pos: { x: number; y: number }[] = [];
  const vel: { x: number; y: number }[] = [];
  const world = {
    created: 0,
    createSensorCircle(x: number, y: number) {
      this.created++;
      pos.push({ x, y });
      vel.push({ x: 0, y: 0 });
      return pos.length - 1;
    },
    setPosition(id: number, x: number, y: number) {
      pos[id] = { x, y };
    },
    setVelocity(id: number, x: number, y: number) {
      vel[id] = { x, y };
    },
    getPosition: (id: number) => pos[id],
    getVelocity: (id: number) => vel[id],
    intersectCircle: () => [] as number[],
  };
  return world;
}

describe("projectile pool", () => {
  const setup = () => {
    const ecs = createEcsWorld();
    const stub = stubWorld();
    createProjectilePool(ecs, stub as unknown as PhysicsWorld);
    return { ecs, stub, world: stub as unknown as PhysicsWorld, events: [] as SimEvent[] };
  };
  const dir = { x: 1, y: 0 };

  it("allocates its bodies and entities once, all inactive", () => {
    const { ecs, stub } = setup();
    expect(stub.created).toBe(P.poolSize);
    expect(entitiesById(ecs)).toHaveLength(P.poolSize);
    expect(activeProjectiles(ecs)).toBe(0);
  });

  it("expires a projectile after exactly lifetimeTicks and returns it to the pool", () => {
    const { ecs, world, events } = setup();
    expect(fireProjectile(ecs, world, { x: 50, y: 50 }, R.radius, dir)).toBe(true);
    for (let i = 0; i < P.lifetimeTicks - 1; i++) projectileSystem(ecs, world, events);
    expect(activeProjectiles(ecs)).toBe(1);
    projectileSystem(ecs, world, events);
    expect(activeProjectiles(ecs)).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("reuses freed slots: no new entities or bodies, and fires nothing when exhausted", () => {
    const { ecs, stub, world, events } = setup();
    const ids = () =>
      [...query(ecs, "projectile")].filter((p) => p.projectile.active).map((p) => p.id);
    for (let i = 0; i < P.poolSize; i++)
      expect(fireProjectile(ecs, world, { x: 0, y: 0 }, 1, dir)).toBe(true);
    expect(fireProjectile(ecs, world, { x: 0, y: 0 }, 1, dir)).toBe(false);
    const all = ids();
    expect(all).toHaveLength(P.poolSize);
    for (let i = 0; i < P.lifetimeTicks; i++) projectileSystem(ecs, world, events);
    expect(activeProjectiles(ecs)).toBe(0);
    for (let round = 0; round < 3; round++) {
      expect(fireProjectile(ecs, world, { x: 0, y: 0 }, 1, dir)).toBe(true);
      expect(ids()).toEqual([all[0]]); // always the first free slot
      for (let i = 0; i < P.lifetimeTicks; i++) projectileSystem(ecs, world, events);
    }
    expect(stub.created).toBe(P.poolSize);
    expect(entitiesById(ecs)).toHaveLength(P.poolSize);
  });

  it("launches from just outside the shooter along the given direction", () => {
    const { ecs, stub, world } = setup();
    fireProjectile(ecs, world, { x: 10, y: 20 }, 6, { x: 0, y: 1 });
    const p = [...query(ecs, "projectile", "body")].find((e) => e.projectile.active);
    expect(stub.getPosition(p?.body as number)).toEqual({ x: 10, y: 20 + 6 + P.radius + 1 });
    expect(stub.getVelocity(p?.body as number)).toEqual({ x: 0, y: P.speed });
  });
});

describe("debug overlay", () => {
  it("shows the projectile count", () => {
    expect(
      describeProjectiles([{ projectile: true }, { projectile: false }, { projectile: true }]),
    ).toBe("projectiles 2");
  });
});

// ---- sim scenarios ----

const hold = (n: number, f: Partial<InputFrame>): InputFrame[] =>
  Array.from({ length: n }, () => ({ ...NO_INPUT, ...f }));

function session() {
  let s: SimState = createSimState(createRapierWorld(), SEED, ARENA);
  const log: InputFrame[] = [];
  /** Shooter state after each tick. */
  const states: string[] = [];
  /** Player HP after each tick. */
  const hp: number[] = [];
  /** In-flight projectile count after each tick. */
  const flying: number[] = [];
  const shooter = () => entityViews(s).find((v) => v.ranged);
  const shots = () => entityViews(s).filter((v) => v.projectile);
  return {
    get s() {
      return s;
    },
    log,
    states,
    hp,
    flying,
    shooter,
    shots,
    tick(f: InputFrame) {
      log.push(f);
      s = step(s, f);
      hp.push(s.player.hp);
      states.push(shooter()?.ai ?? "gone");
      flying.push(shots().length);
    },
    go(frames: InputFrame[]) {
      for (const f of frames) this.tick(f);
    },
  };
}

type Session = ReturnType<typeof session>;

function expectReplay(t: Session, hash: string) {
  const replay = buildReplay(ARENA_FLOOR.id, SEED, t.log, t.s);
  const again = runReplay(
    parseReplay(JSON.parse(JSON.stringify(replay))),
    createRapierWorld(),
    ARENA_FLOOR,
    ARENA_ROOMS,
  );
  expect(hashSimState(again)).toBe(hashSimState(t.s));
  expect(hashSimState(t.s)).toBe(hash);
}

describe("ranged scenarios", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it("the test room holds one shooter at its fixed spot, idle, with no projectile in flight", () => {
    const s = createSimState(createRapierWorld(), SEED, ARENA);
    const views = entityViews(s);
    const shooter = views.filter((v) => v.ranged);
    expect(shooter.map((v) => [v.x, v.y, v.ai])).toEqual([
      [RANGED_START.x, RANGED_START.y, "idle"],
    ]);
    expect(views.filter((v) => v.ai !== null && !v.ranged)).toHaveLength(2);
    expect(views.filter((v) => v.projectile)).toHaveLength(0);
  });

  it("(a) the shooter telegraphs and fires; the projectile hits the player once", () => {
    const t = session();
    t.go(hold(10, { right: true })); // step into its aggro range
    t.go(hold(110, {}));
    const tele = t.states.indexOf("telegraph");
    const fire = t.states.indexOf("fire");
    expect(tele).toBeGreaterThan(-1);
    expect(fire - tele).toBe(R.telegraphTicks);
    expect(t.flying[fire]).toBe(1); // spawned on the fire tick
    // No damage until the projectile lands, then exactly its damage, once.
    const hitTick = t.hp.findIndex((h) => h < PLAYER_DATA.hp);
    expect(hitTick).toBeGreaterThan(fire);
    expect(
      t.hp.filter((h) => h < PLAYER_DATA.hp).every((h) => h === PLAYER_DATA.hp - P.damage),
    ).toBe(true);
    expect(t.s.player.hp).toBe(PLAYER_DATA.hp - P.damage);
    expect(t.flying[hitTick]).toBe(0); // consumed by the hit
    expect(t.s.player.dead).toBe(false);
    expectReplay(t, HIT_HASH);
  });

  it("(b) dashing through a projectile takes no damage", () => {
    const t = session();
    t.go(hold(10, { right: true }));
    let guard = 0;
    while (t.shots().length === 0 && guard++ < 200) t.tick(NO_INPUT);
    expect(t.shots().length).toBe(1);
    // Wait until it is close, then dash straight at it.
    let dashed = false;
    let overlapped = false;
    for (let i = 0; i < 120 && (t.shots().length > 0 || !dashed); i++) {
      const shot = t.shots()[0];
      const me = t.s.player;
      const dx = shot ? shot.x - me.x : 0;
      const dy = shot ? shot.y - me.y : 0;
      const near = shot !== undefined && Math.hypot(dx, dy) < 30;
      if (near && !dashed) {
        dashed = true;
        t.tick({
          ...NO_INPUT,
          dash: true,
          left: dx < -1,
          right: dx > 1,
          up: dy < -1,
          down: dy > 1,
        });
      } else {
        t.tick(NO_INPUT);
      }
      const now = t.shots()[0];
      if (now && Math.hypot(now.x - t.s.player.x, now.y - t.s.player.y) < 6 + P.radius) {
        overlapped = overlapped || t.s.player.invulnerable;
      }
    }
    expect(dashed).toBe(true);
    expect(overlapped).toBe(true); // it really passed through the player while invulnerable
    expect(Math.min(...t.hp)).toBe(PLAYER_DATA.hp);
    expect(t.s.player.hp).toBe(PLAYER_DATA.hp);
    expectReplay(t, DASH_HASH);
  });

  it("(c) a projectile that misses and hits a wall disappears", () => {
    const t = session();
    // The aim locks when the telegraph starts (during this walk); stepping up dodges the shot.
    t.go(hold(10, { right: true }));
    t.go(hold(24, { up: true }));
    const first = t.shots()[0]?.id;
    expect(first).toBeDefined();
    // Dodge the second shot as well, so only the first one's fate is under test.
    while (t.states[t.states.length - 1] !== "telegraph") t.tick(NO_INPUT);
    t.go(hold(20, { up: true, right: true }));
    let last: { x: number; y: number } | undefined;
    let age = 0;
    for (let i = 0; i < 400; i++) {
      t.tick(NO_INPUT);
      const shot = t.shots().find((v) => v.id === first);
      if (!shot) break;
      last = { x: shot.x, y: shot.y };
      age++;
    }
    expect(t.s.player.hp).toBe(PLAYER_DATA.hp);
    expect(t.shots().some((v) => v.id === first)).toBe(false);
    expect(last).toBeDefined();
    // It ended against a wall, well before its lifetime ran out.
    const { x, y } = last as { x: number; y: number };
    const nearWall = x < 6 || y < 6 || x > 314 || y > 218;
    expect(nearWall).toBe(true);
    expect(age).toBeLessThan(P.lifetimeTicks);
    expectReplay(t, WALL_HASH);
  });

  it("projectiles fly through enemies and other projectiles, and have nothing for a swing to hit", () => {
    let s = createSimState(createRapierWorld(), SEED, ARENA);
    // Two shots along the chaser's row at (40, 48), straight at the left wall.
    const left = { x: -1, y: 0 };
    expect(fireProjectile(s.ecs, s.world, { x: 90, y: 48 }, 6, left)).toBe(true);
    expect(fireProjectile(s.ecs, s.world, { x: 90, y: 48 }, 6, left)).toBe(true);
    // The swing only selects bodies that have health; pooled projectiles never do.
    expect([...query(s.ecs, "projectile")].every((p) => p.health === undefined)).toBe(true);
    const chaserHp = () => entityViews(s).find((v) => v.ai !== null && !v.ranged)?.hp;
    const hp0 = chaserHp();
    let seenOverChaser = 0;
    for (let i = 0; i < 80; i++) {
      s = step(s, NO_INPUT);
      for (const v of entityViews(s).filter((e) => e.projectile)) {
        if (Math.abs(v.x - 40) < 4 && Math.abs(v.y - 48) < 4) seenOverChaser++;
      }
    }
    expect(seenOverChaser).toBeGreaterThan(0); // they really crossed the chaser
    expect(chaserHp()).toBe(hp0);
    expect(activeProjectiles(s.ecs)).toBe(0); // and ended on the wall behind it
    expect(s.player.hp).toBe(PLAYER_DATA.hp);
  });
});

const HIT_HASH = "91cbc37e";
const DASH_HASH = "1714133a";
const WALL_HASH = "766df09d";
