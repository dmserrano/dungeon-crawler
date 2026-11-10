import type { AiState } from "./ai/chaser";
import { aiSystem, spawnChaser } from "./ai/system";
import {
  type AttackPhase,
  attackPhaseAt,
  damageSystem,
  freezeSystem,
  isFrozen,
  meleeSystem,
  releaseSystem,
  type SimEvent,
} from "./combat";
import { DUMMY_DATA } from "./data/dummy";
import { PLAYER_DATA } from "./data/player";
import {
  addComponent,
  createEcsWorld,
  createEntity,
  type EcsWorld,
  type Entity,
  entitiesById,
  query,
  removeComponent,
} from "./ecs/world";
import { aimToDir, type InputFrame } from "./input-frame";
import type { BodyId, PhysicsWorld } from "./physics/physics-world";
import { createRng, type Rng } from "./rng/rng";
import { CHASER_STARTS, DUMMY_START, PLAYER_START, ROOM_WALLS } from "./room";
import { hashState } from "./state/hash";

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

export interface PlayerSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks until the next dash is allowed (0 = ready). */
  dashCooldown: number;
  dashing: boolean;
  /** Dash i-frames or post-hit invulnerability. */
  invulnerable: boolean;
  hp: number;
  maxHp: number;
  /** Phase of the swing in progress, or null. */
  attack: AttackPhase | null;
  /** Hitstop ticks left. */
  frozen: number;
  dead: boolean;
}

export interface SimState {
  readonly tick: number;
  readonly seed: number;
  readonly rng: Rng;
  readonly world: PhysicsWorld;
  readonly ecs: EcsWorld;
  readonly playerId: BodyId;
  readonly player: PlayerSnapshot;
  /** Event queue: damage is consumed within the tick; death notices last until the next tick. */
  readonly events: SimEvent[];
}

/** Render-facing view of a non-player entity. */
export interface EntityView {
  id: number;
  x: number;
  y: number;
  radius: number;
  hp: number;
  /** True during hitstop (render-only flash). */
  flash: boolean;
  /** Enemy behavior state, or null for non-enemies (the dummy). */
  ai: AiState | null;
}

export function entityViews(state: SimState): EntityView[] {
  return entitiesById(state.ecs)
    .filter((e) => !e.player && e.position && e.radius !== undefined)
    .map((e) => ({
      id: e.id,
      x: e.position?.x ?? 0,
      y: e.position?.y ?? 0,
      radius: e.radius ?? 0,
      hp: e.health?.hp ?? 0,
      flash: isFrozen(e),
      ai: e.ai?.state ?? null,
    }));
}

function snapshotOf(e: Entity): PlayerSnapshot {
  const { position: p, velocity: v } = e;
  return {
    x: p?.x ?? 0,
    y: p?.y ?? 0,
    vx: v?.x ?? 0,
    vy: v?.y ?? 0,
    dashCooldown: e.dashCooldown ?? 0,
    dashing: e.dash !== undefined,
    invulnerable: e.invulnerable === true || (e.iframes ?? 0) > 0,
    hp: e.health?.hp ?? 0,
    maxHp: e.health?.max ?? 0,
    attack: e.attack ? attackPhaseAt(e.attack.t) : null,
    frozen: e.frozen ?? 0,
    dead: e.health !== undefined && e.health.hp <= 0,
  };
}

function playerEntity(ecs: EcsWorld): Entity {
  for (const e of query(ecs, "player")) return e;
  throw new Error("no player entity");
}

/** Pull physics positions/velocities into components. */
function syncSystem(ecs: EcsWorld, world: PhysicsWorld): void {
  for (const e of query(ecs, "body")) {
    const p = world.getPosition(e.body);
    const v = world.getVelocity(e.body);
    e.position = { x: p.x, y: p.y };
    e.velocity = { x: v.x, y: v.y };
  }
}

/** Build the initial state. `world` must be a fresh, empty physics world. */
export function createSimState(world: PhysicsWorld, seed: number): SimState {
  for (const w of ROOM_WALLS) world.createStaticBox(w.x, w.y, w.hw, w.hh);
  const playerId = world.createDynamicCircle(PLAYER_START.x, PLAYER_START.y, PLAYER_DATA.radius);
  const ecs = createEcsWorld();
  createEntity(ecs, {
    player: true,
    body: playerId,
    move: { x: 0, y: 0 },
    buttons: { aim: 0, attack: false, dash: false },
    dashCooldown: 0,
    health: { hp: PLAYER_DATA.hp, max: PLAYER_DATA.hp, iframeTicks: PLAYER_DATA.invulnTicks },
    radius: PLAYER_DATA.radius,
  });
  // Training dummy: solid, never moves, takes damage and dies.
  createEntity(ecs, {
    dummy: true,
    body: world.createStaticCircle(DUMMY_START.x, DUMMY_START.y, DUMMY_DATA.radius),
    health: { hp: DUMMY_DATA.hp, max: DUMMY_DATA.hp, iframeTicks: DUMMY_DATA.invulnTicks },
    radius: DUMMY_DATA.radius,
  });
  for (const c of CHASER_STARTS) spawnChaser(ecs, world, c.x, c.y);
  syncSystem(ecs, world);
  return {
    events: [],
    tick: 0,
    seed,
    rng: createRng(seed),
    world,
    ecs,
    playerId,
    player: snapshotOf(playerEntity(ecs)),
  };
}

function inputSystem(ecs: EcsWorld, input: InputFrame): void {
  const axisX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const axisY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  for (const e of query(ecs, "player", "move")) {
    e.move = { x: axisX, y: axisY };
    e.buttons = { aim: input.aim, attack: input.attack, dash: input.dash };
  }
}

/**
 * Starts dashes and drives active ones. A dash overrides velocity every tick, so walls still
 * block it through the physics step. Direction is movement input, else aim. i-frames cover the
 * first `iframeTicks` ticks; the cooldown runs from the dash start.
 */
function dashSystem(ecs: EcsWorld, world: PhysicsWorld): void {
  const { distance, ticks, iframeTicks, cooldownTicks } = PLAYER_DATA.dash;
  const speed = distance / ticks / TICK_DT;
  for (const e of query(ecs, "player", "body", "move", "buttons")) {
    if (isFrozen(e)) continue;
    if (e.dashCooldown !== undefined && e.dashCooldown > 0) e.dashCooldown--;
    if (!e.dash && e.buttons.dash && (e.dashCooldown ?? 0) === 0) {
      const len = Math.hypot(e.move.x, e.move.y);
      const dir = len > 0 ? { x: e.move.x / len, y: e.move.y / len } : aimToDir(e.buttons.aim);
      addComponent(ecs, e, "dash", { dx: dir.x, dy: dir.y, elapsed: 0 });
      e.dashCooldown = cooldownTicks;
    }
    const d = e.dash;
    if (!d) continue;
    world.setVelocity(e.body, d.dx * speed, d.dy * speed);
    if (d.elapsed < iframeTicks) {
      if (!e.invulnerable) addComponent(ecs, e, "invulnerable", true);
    } else if (e.invulnerable) {
      removeComponent(ecs, e, "invulnerable");
    }
    d.elapsed++;
    if (d.elapsed >= ticks) removeComponent(ecs, e, "dash");
  }
}

/**
 * Walking. Slowed while swinging. Staggered entities (just knocked back) ignore input and only
 * lose speed to damping, so the knockback is not clipped by the walking speed cap.
 */
function movementSystem(ecs: EcsWorld, world: PhysicsWorld): void {
  const { damping } = PLAYER_DATA;
  for (const e of query(ecs, "player", "body", "move")) {
    if (isFrozen(e)) continue;
    const scale = e.attack ? PLAYER_DATA.attack.moveScale : 1;
    const acceleration = PLAYER_DATA.acceleration * scale;
    const maxSpeed = PLAYER_DATA.maxSpeed * scale;
    const v = world.getVelocity(e.body);
    if (e.stagger !== undefined) {
      world.setVelocity(e.body, v.x * damping, v.y * damping);
      if (--e.stagger <= 0) removeComponent(ecs, e, "stagger");
      continue;
    }
    const len = Math.hypot(e.move.x, e.move.y) || 1;
    let vx = (v.x + (e.move.x / len) * acceleration * TICK_DT) * damping;
    let vy = (v.y + (e.move.y / len) * acceleration * TICK_DT) * damping;
    const speed = Math.hypot(vx, vy);
    if (speed > maxSpeed) {
      vx = (vx / speed) * maxSpeed;
      vy = (vy / speed) * maxSpeed;
    }
    world.setVelocity(e.body, vx, vy);
  }
}

/**
 * Advance the world exactly one fixed tick: input -> movement -> physics step -> sync.
 * The physics and ECS worlds are mutated in place; the returned state holds the new snapshot.
 */
export function step(state: SimState, input: InputFrame): SimState {
  if (state.player.dead) return state; // player death stops the sim
  const { world, ecs, events } = state;
  // Last tick's death notices go; queued damage (e.g. from hazards or tests) stays for this tick.
  for (let i = events.length - 1; i >= 0; i--) if (events[i]?.kind === "death") events.splice(i, 1);
  inputSystem(ecs, input);
  releaseSystem(ecs, world);
  movementSystem(ecs, world);
  dashSystem(ecs, world); // runs after movement: an active dash overrides the walking velocity
  aiSystem(ecs, world, events);
  meleeSystem(ecs, world, events);
  damageSystem(ecs, world, events);
  freezeSystem(ecs, world);
  world.step(TICK_DT);
  world.drainCollisionEvents(); // nothing consumes events yet; keep the queue empty
  syncSystem(ecs, world);
  return { ...state, tick: state.tick + 1, player: snapshotOf(playerEntity(ecs)) };
}

/**
 * Plain, serialisable view of the state (everything that must match across replays).
 * Non-player entities are serialised sorted by id under `entities`; the key is omitted while
 * there are none, so a player-only world hashes exactly as it did before the ECS.
 */
export function stateSnapshot(state: SimState) {
  const others = entitiesById(state.ecs)
    .filter((e) => !e.player)
    .map((e) => ({
      id: e.id,
      position: e.position,
      velocity: e.velocity,
      hp: e.health?.hp ?? 0,
      iframes: e.iframes ?? 0,
      frozen: e.frozen ?? 0,
      ...(e.ai ? { ai: { state: e.ai.state, t: e.ai.t, cooldown: e.ai.cooldown } } : {}),
    }));
  return {
    tick: state.tick,
    seed: state.seed,
    rng: state.rng.state,
    player: state.player,
    ...(others.length > 0 ? { entities: others } : {}),
  };
}

export function hashSimState(state: SimState): string {
  return hashState(stateSnapshot(state));
}
