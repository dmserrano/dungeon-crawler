import { beforeAll, describe, expect, it } from "vitest";
import enemiesJson from "../data/enemies.json";
import { enemiesDataSchema } from "../data/schemas/enemies";
import { describeEnemies } from "../src/debug/stats";
import { type AiMemory, type AiSense, newAiMemory, nextAiState } from "../src/sim/ai/chaser";
import { spawnChaser, steer } from "../src/sim/ai/system";
import { CHASER_DATA, parseEnemiesData, RANGED_DATA } from "../src/sim/data/enemies";
import { PLAYER_DATA } from "../src/sim/data/player";
import { entitiesById } from "../src/sim/ecs/world";
import { type InputFrame, NO_INPUT, quantizeAim } from "../src/sim/input-frame";
import type { PhysicsWorld } from "../src/sim/physics/physics-world";
import { createRapierWorld, initPhysics } from "../src/sim/physics/rapier-world";
import { buildReplay, parseReplay, runReplay } from "../src/sim/replay";
import { CHASER_STARTS } from "../src/sim/room";
import { createSimState, entityViews, hashSimState, type SimState, step } from "../src/sim/step";

const D = CHASER_DATA;
const SEED = 21;

describe("enemy data", () => {
  it("loads data/enemies.json and describes the chaser fully", () => {
    expect(D.telegraphTicks).toBe(12);
    expect(D.lunge.speed).toBeGreaterThan(D.speed);
    expect(D.contactDamage).toBeGreaterThan(0);
  });

  it.each([
    ["unknown key", { chaser: { ...D, extra: 1 } }],
    ["missing field", { chaser: { ...D, telegraphTicks: undefined } }],
    ["non-integer ticks", { chaser: { ...D, telegraphTicks: 1.5 } }],
    ["zero hp", { chaser: { ...D, hp: 0 } }],
    ["attackRange beyond aggroRange", { chaser: { ...D, attackRange: D.aggroRange } }],
    ["no chaser", {}],
  ])("rejects %s", (_name, bad) => {
    expect(enemiesDataSchema.safeParse(bad).success).toBe(false);
    expect(() => parseEnemiesData(bad)).toThrow(/enemies\.json/);
  });

  it("accepts the shipped file", () => {
    expect(enemiesDataSchema.safeParse(enemiesJson).success).toBe(true);
  });
});

describe("chaser state machine (pure, from data)", () => {
  const near = (dist: number, extra: Partial<AiSense> = {}): AiSense => ({
    dist,
    toPlayer: { x: 1, y: 0 },
    staggered: false,
    dead: false,
    ...extra,
  });
  const at = (state: AiMemory["state"], patch: Partial<AiMemory> = {}): AiMemory => ({
    ...newAiMemory(),
    state,
    ...patch,
  });

  it("idles until the player is inside the aggro range", () => {
    expect(nextAiState(newAiMemory(), near(D.aggroRange + 1), D).state).toBe("idle");
    expect(nextAiState(newAiMemory(), near(D.aggroRange), D).state).toBe("chase");
  });

  it("starts the telegraph in attack range once the cooldown is over, locking the direction", () => {
    const m = nextAiState(at("chase"), near(D.attackRange, { toPlayer: { x: 0, y: 1 } }), D);
    expect(m.state).toBe("telegraph");
    expect(m.dir).toEqual({ x: 0, y: 1 });
    expect(nextAiState(at("chase"), near(D.attackRange + 1), D).state).toBe("chase");
    expect(nextAiState(at("chase", { cooldown: 3 }), near(1), D).state).toBe("chase");
  });

  it("telegraphs for exactly telegraphTicks, then lunges for exactly lunge.ticks", () => {
    let m = nextAiState(at("chase"), near(10), D);
    const seq: string[] = [m.state];
    for (let i = 0; i < D.telegraphTicks + D.lunge.ticks + 1; i++) {
      m = nextAiState(m, near(10), D);
      seq.push(m.state);
    }
    const telegraphTicks = seq.filter((s) => s === "telegraph").length;
    const attackTicks = seq.filter((s) => s === "attack").length;
    expect(telegraphTicks).toBe(D.telegraphTicks);
    expect(attackTicks).toBe(D.lunge.ticks);
    expect(seq[telegraphTicks]).toBe("attack");
    expect(seq[telegraphTicks + attackTicks]).toBe("chase");
    expect(m.cooldown).toBeLessThanOrEqual(D.cooldownTicks);
  });

  it("returns to chase with a cooldown after the lunge, which then blocks a new telegraph", () => {
    const m = nextAiState(at("attack", { t: D.lunge.ticks - 1 }), near(5), D);
    expect(m.state).toBe("chase");
    expect(m.cooldown).toBe(D.cooldownTicks);
    expect(nextAiState(m, near(5), D).state).toBe("chase");
  });

  it.each(["chase", "telegraph", "attack", "idle"] as const)(
    "a hit interrupts %s into stagger",
    (s) => {
      const m = nextAiState(at(s, { t: 3 }), near(10, { staggered: true }), D);
      expect(m.state).toBe("stagger");
      expect(m.t).toBe(0);
      expect(m.spent).toBe(false);
    },
  );

  it("stays staggered while hit, then resumes chasing with a cooldown", () => {
    let m = nextAiState(at("attack"), near(10, { staggered: true }), D);
    m = nextAiState(m, near(10, { staggered: true }), D);
    expect(m.state).toBe("stagger");
    expect(m.t).toBe(1);
    m = nextAiState(m, near(10), D);
    expect(m.state).toBe("chase");
    expect(m.cooldown).toBeGreaterThan(0);
  });

  it("dead is terminal", () => {
    const m = nextAiState(at("chase"), near(10, { dead: true }), D);
    expect(m.state).toBe("dead");
    expect(nextAiState(m, near(1), D)).toBe(m);
  });

  it("is a pure function of its inputs", () => {
    const run = () => {
      let m = newAiMemory();
      const out: string[] = [];
      for (let i = 0; i < 120; i++) {
        m = nextAiState(m, near(i < 40 ? 100 : 10, { staggered: i === 70 }), D);
        out.push(`${m.state}:${m.t}:${m.cooldown}`);
      }
      return out.join(",");
    };
    expect(run()).toBe(run());
  });
});

describe("steering", () => {
  const e = { id: 1, position: { x: 100, y: 100 }, radius: 6 };
  const raycastWith = (blocked: (dx: number, dy: number) => boolean) =>
    ({
      raycast: (_o: unknown, d: { x: number; y: number }) =>
        blocked(d.x, d.y) ? { body: 99, toi: 5, point: { x: 0, y: 0 } } : null,
    }) as unknown as PhysicsWorld;

  it("heads straight for the player when nothing is in the way", () => {
    const dir = steer(
      e,
      1,
      { x: 1, y: 0 },
      [],
      raycastWith(() => false),
      new Set(),
    );
    expect(dir).toEqual({ x: 1, y: 0 });
  });

  it("turns away from a wall dead ahead", () => {
    const dir = steer(
      e,
      1,
      { x: 1, y: 0 },
      [],
      raycastWith((dx, dy) => dx > 0.99 && dy === 0),
      new Set(),
    );
    expect(dir.x).toBeGreaterThan(0);
    expect(Math.abs(dir.y)).toBeGreaterThan(0.5);
  });

  it("ignores the player and other enemies as obstacles", () => {
    const world = {
      raycast: () => ({ body: 7, toi: 3, point: { x: 0, y: 0 } }),
    } as unknown as PhysicsWorld;
    expect(steer(e, 1, { x: 1, y: 0 }, [], world, new Set([7]))).toEqual({ x: 1, y: 0 });
  });

  it("keeps going when every direction is blocked", () => {
    const dir = steer(
      e,
      1,
      { x: 1, y: 0 },
      [],
      raycastWith(() => true),
      new Set(),
    );
    expect(dir).toEqual({ x: 1, y: 0 });
  });

  it("is pushed softly away from a close neighbour", () => {
    const other = { id: 2, position: { x: 100, y: 108 } };
    const dir = steer(
      e,
      1,
      { x: 1, y: 0 },
      [other as never],
      raycastWith(() => false),
      new Set(),
    );
    expect(dir.y).toBeLessThan(0);
    expect(dir.x).toBeGreaterThan(0);
  });
});

describe("debug overlay", () => {
  it("shows the enemy count and each state name", () => {
    const text = describeEnemies([
      { id: 1, ai: null },
      { id: 3, ai: "chase" },
      { id: 4, ai: "telegraph" },
    ]);
    expect(text).toBe("enemies 2\n  #3 chase\n  #4 telegraph");
  });
});

// ---- sim scenarios ----

const hold = (n: number, f: Partial<InputFrame>): InputFrame[] =>
  Array.from({ length: n }, () => ({ ...NO_INPUT, ...f }));

function session() {
  let s: SimState = createSimState(createRapierWorld(), SEED);
  const log: InputFrame[] = [];
  const states: Record<number, string[]> = {};
  /** Player HP after each tick. */
  const hp: number[] = [];
  const chasers = () => entityViews(s).filter((v) => v.ai !== null && !v.ranged);
  return {
    get s() {
      return s;
    },
    log,
    states,
    hp,
    chasers,
    /** Advance one tick and remember each chaser's state. */
    tick(f: InputFrame) {
      log.push(f);
      s = step(s, f);
      hp.push(s.player.hp);
      for (const c of chasers()) {
        const seen = states[c.id] ?? [];
        seen.push(c.ai as string);
        states[c.id] = seen;
      }
    },
    go(frames: InputFrame[]) {
      for (const f of frames) this.tick(f);
    },
  };
}

type Session = ReturnType<typeof session>;

/** Walk left until the chasers wake up (they idle outside their aggro range). */
function wake(t: Session) {
  t.go(hold(20, { left: true }));
  t.go(hold(10, {}));
}

/** Round-trips the log through the replay format and checks the hash. */
function expectReplay(t: Session, hash: string) {
  const replay = buildReplay(SEED, t.log, t.s);
  const again = runReplay(parseReplay(JSON.parse(JSON.stringify(replay))), createRapierWorld());
  expect(hashSimState(again)).toBe(hashSimState(t.s));
  expect(hashSimState(t.s)).toBe(hash);
}

const firstIndex = (arr: string[], v: string) => arr.indexOf(v);

describe("chaser scenarios", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it("spawns two chasers at the fixed positions next to the training dummy", () => {
    const s = createSimState(createRapierWorld(), SEED);
    const views = entityViews(s);
    expect(views.filter((v) => v.ai === "idle" && !v.ranged).map((v) => [v.x, v.y])).toEqual(
      CHASER_STARTS.map((c) => [c.x, c.y]),
    );
    expect(entitiesById(s.ecs).some((e) => e.dummy)).toBe(true);
    expect(views.filter((v) => v.ranged)).toHaveLength(1);
    expect(views).toHaveLength(4); // dummy, 2 chasers, ranged (no projectile in flight)
  });

  it("stay idle while the player is far away", () => {
    const t = session();
    t.go(hold(60, {}));
    expect(t.chasers().every((c) => c.ai === "idle")).toBe(true);
  });

  it("separate softly from each other", () => {
    const world = createRapierWorld();
    const s = createSimState(world, SEED);
    const a = spawnChaser(s.ecs, world, 220, 150);
    const b = spawnChaser(s.ecs, world, 222, 150);
    let st = s;
    const gap = () =>
      Math.hypot(
        (a.position?.x ?? 0) - (b.position?.x ?? 0),
        (a.position?.y ?? 0) - (b.position?.y ?? 0),
      );
    st = step(st, NO_INPUT);
    const before = gap();
    for (let i = 0; i < 20; i++) st = step(st, NO_INPUT);
    expect(gap()).toBeGreaterThan(before);
  });

  it("(a) a chaser reaches the player, telegraphs, lunges and damages once", () => {
    const t = session();
    wake(t);
    const maxHp = PLAYER_DATA.hp;
    for (let i = 0; i < 300 && t.s.player.hp === maxHp; i++) t.tick(NO_INPUT);
    // Both chasers lunge together; the second one lands inside the player's i-frames.
    t.go(hold(PLAYER_DATA.invulnTicks - 1, {}));
    const [id] = Object.keys(t.states).map(Number) as [number];
    const seq = t.states[id] as string[];
    const chase = firstIndex(seq, "chase");
    const tele = firstIndex(seq, "telegraph");
    const atk = firstIndex(seq, "attack");
    expect(chase).toBeGreaterThan(-1);
    expect(tele).toBeGreaterThan(chase);
    expect(atk - tele).toBe(D.telegraphTicks);
    // No damage before the lunge starts; exactly one hit once it has landed.
    expect(Math.min(...t.hp.slice(0, atk))).toBe(maxHp);
    expect(t.s.player.hp).toBe(maxHp - D.contactDamage);
    expect(t.s.player.dead).toBe(false);
    expectReplay(t, CONTACT_HASH);
  });

  it("(b) dashing through the lunge takes no damage", () => {
    const t = session();
    wake(t);
    // Wait for the lunge to begin, then dash straight through the chasers.
    let guard = 0;
    while (!t.chasers().some((c) => c.ai === "attack") && guard++ < 300) t.tick(NO_INPUT);
    expect(t.chasers().some((c) => c.ai === "attack")).toBe(true);
    t.go(hold(DASH_TICKS, { dash: true, left: true }));
    t.go(hold(60, {}));
    expect(t.s.player.hp).toBe(PLAYER_DATA.hp);
    expect(t.states[t.chasers()[0]?.id as number]).toContain("attack");
    expectReplay(t, DASH_HASH);
  });

  it("(c) the player kills a chaser with the swing; a hit staggers it out of its lunge", () => {
    const t = session();
    wake(t);
    let sawStagger = false;
    for (let i = 0; i < 600 && t.chasers().length === 2 && !t.s.player.dead; i++) {
      const me = t.s.player;
      const target = [...t.chasers()].sort(
        (p, q) => Math.hypot(p.x - me.x, p.y - me.y) - Math.hypot(q.x - me.x, q.y - me.y),
      )[0];
      if (!target) break;
      const dx = target.x - me.x;
      const dy = target.y - me.y;
      const close = Math.hypot(dx, dy) <= 24;
      t.tick({
        ...NO_INPUT,
        aim: quantizeAim(dx, dy),
        attack: close,
        left: !close && dx < -2,
        right: !close && dx > 2,
        up: !close && dy < -2,
        down: !close && dy > 2,
      });
      if (t.chasers().some((c) => c.ai === "stagger")) sawStagger = true;
    }
    expect(t.s.player.dead).toBe(false);
    expect(t.chasers()).toHaveLength(1);
    expect(sawStagger).toBe(true);
    expect(t.s.world.bodyCount()).toBe(8 + POOL); // walls, player, dummy, chaser, ranged, pool
    expectReplay(t, KILL_HASH);
  });
});

const POOL = RANGED_DATA.projectile.poolSize;
const DASH_TICKS = PLAYER_DATA.dash.ticks;
const CONTACT_HASH = "1305e3d1";
const DASH_HASH = "4b126430";
const KILL_HASH = "b67b8bc9";
