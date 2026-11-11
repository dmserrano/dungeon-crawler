import type { AiState } from "./ai/memory";
import { aiSystem } from "./ai/system";
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
import type { RoomSource } from "./floor";
import { aimToDir, type InputFrame } from "./input-frame";
import { buildNavGrid, type NavGrid } from "./pathfinding";
import type { BodyId, PhysicsWorld } from "./physics/physics-world";
import { createProjectilePool, projectileSystem } from "./projectile";
import { createRng, type Rng } from "./rng/rng";
import type { Room } from "./room";
import {
  arrivalPoint,
  createWalls,
  haltPlayer,
  lockDoors,
  spawnRoomEntities,
  TRANSITION_MIDPOINT,
  TRANSITION_TICKS,
  type Transition,
  teardownRoom,
  touchedDoor,
  unlockDoors,
} from "./run";
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
  /** Wall grid for enemy pathfinding (static for the active room). */
  readonly nav: NavGrid;
  /** Run record: id and data of the active room, and the ids of rooms cleared so far (sorted). */
  readonly roomId: string;
  readonly room: Room;
  readonly clearedRooms: readonly string[];
  /** Looks up the room a door leads to. */
  readonly rooms: RoomSource;
  /** Door transition in progress (input ignored), or null. */
  readonly transition: Transition | null;
  /** True while the active room's doors are locked shut (live enemies, not yet cleared). */
  readonly locked: boolean;
  /** Static bodies of the active room: walls, and door locks while locked. */
  readonly wallBodies: readonly BodyId[];
  readonly lockBodies: readonly BodyId[];
  readonly playerId: BodyId;
  readonly player: PlayerSnapshot;
  /** Event queue: damage is consumed within the tick; death notices last until the next tick. */
  readonly events: SimEvent[];
  /** True once every enemy of the active room is dead ("room cleared"). */
  readonly cleared: boolean;
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
  /** True for the ranged enemy. */
  ranged: boolean;
  /** True for an in-flight projectile. */
  projectile: boolean;
}

export function entityViews(state: SimState): EntityView[] {
  return entitiesById(state.ecs)
    .filter((e) => !e.player && e.position && e.radius !== undefined && isLive(e))
    .map((e) => ({
      id: e.id,
      x: e.position?.x ?? 0,
      y: e.position?.y ?? 0,
      radius: e.radius ?? 0,
      hp: e.health?.hp ?? 0,
      flash: isFrozen(e),
      ai: e.ai?.state ?? null,
      ranged: e.ranged === true,
      projectile: e.projectile !== undefined,
    }));
}

/** Pooled projectiles that are not in flight do not exist as far as views and hashes go. */
const isLive = (e: Entity): boolean => e.projectile === undefined || e.projectile.active;

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

/** Enemies and the dummy are the non-player entities with health (projectiles have none). */
function noEnemiesLeft(ecs: EcsWorld): boolean {
  for (const e of query(ecs, "health")) if (!e.player) return false;
  return true;
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

export interface SimOptions {
  /**
   * Id of `room` in the floor. The default is the id of the one standalone room tests and tools
   * use (`test-arena`), so a bare `createSimState(world, seed, arena)` hashes like a replay run.
   */
  roomId?: string;
  /** Resolves door targets; the default knows only `room`. */
  rooms?: RoomSource;
}

/** Build the initial state. `world` must be a fresh, empty physics world. */
export function createSimState(
  world: PhysicsWorld,
  seed: number,
  room: Room,
  opts: SimOptions = {},
): SimState {
  const roomId = opts.roomId ?? "test-arena";
  const wallBodies = createWalls(world, room);
  const playerId = world.createDynamicCircle(
    room.playerStart.x,
    room.playerStart.y,
    PLAYER_DATA.radius,
  );
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
  // Entering a room with live enemies locks its doors (a room with none never locks).
  const hostile = spawnRoomEntities(ecs, world, room);
  const lockBodies = hostile ? lockDoors(world, room) : [];
  createProjectilePool(ecs, world);
  syncSystem(ecs, world);
  return {
    events: [],
    cleared: false,
    roomId,
    room,
    clearedRooms: [],
    rooms:
      opts.rooms ??
      ((id) => {
        if (id === roomId) return room;
        throw new Error(`unknown room "${id}"`);
      }),
    transition: null,
    locked: hostile,
    wallBodies,
    lockBodies,
    tick: 0,
    seed,
    rng: createRng(seed),
    world,
    ecs,
    nav: buildNavGrid(room),
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
  for (let i = events.length - 1; i >= 0; i--) {
    const kind = events[i]?.kind;
    if (kind === "death" || kind === "cleared") events.splice(i, 1);
  }
  if (state.transition) return stepTransition(state, state.transition);
  inputSystem(ecs, input);
  releaseSystem(ecs, world);
  movementSystem(ecs, world);
  dashSystem(ecs, world); // runs after movement: an active dash overrides the walking velocity
  aiSystem(ecs, world, events, state.nav);
  projectileSystem(ecs, world, events);
  meleeSystem(ecs, world, events);
  damageSystem(ecs, world, events);
  freezeSystem(ecs, world);
  world.step(TICK_DT);
  world.drainCollisionEvents(); // nothing consumes events yet; keep the queue empty
  syncSystem(ecs, world);
  const cleared = state.cleared || noEnemiesLeft(ecs);
  let { locked, lockBodies, clearedRooms } = state;
  if (cleared && !state.cleared) {
    events.push({ kind: "cleared" });
    clearedRooms = [...clearedRooms, state.roomId].sort();
    unlockDoors(world, lockBodies);
    locked = false;
    lockBodies = [];
  }
  const me = playerEntity(ecs);
  let transition: Transition | null = null;
  if (!locked && (me.health?.hp ?? 0) > 0) {
    const door = touchedDoor(state.room, me.position ?? { x: 0, y: 0 }, PLAYER_DATA.radius);
    if (door) {
      transition = { t: 0, to: door.to, toDoor: door.toDoor };
      haltPlayer(ecs, world);
    }
  }
  return {
    ...state,
    cleared,
    locked,
    lockBodies,
    clearedRooms,
    transition,
    tick: state.tick + 1,
    player: snapshotOf(me),
  };
}

/**
 * One tick of a door transition: input is ignored and nothing else runs. At the midpoint the old
 * room is torn down and the new one built with the player at the paired door; when it ends the
 * enemies spawn (unless the room is already cleared) and the doors lock if any are alive.
 */
function stepTransition(state: SimState, tr: Transition): SimState {
  const { world, ecs, events } = state;
  for (let i = events.length - 1; i >= 0; i--) {
    const kind = events[i]?.kind;
    if (kind === "death" || kind === "cleared") events.splice(i, 1);
  }
  const t = tr.t + 1;
  const done = t >= TRANSITION_TICKS;
  let next: SimState = { ...state, tick: state.tick + 1, transition: done ? null : { ...tr, t } };
  if (t === TRANSITION_MIDPOINT) {
    teardownRoom(ecs, world, [...state.wallBodies, ...state.lockBodies]);
    const room = state.rooms(tr.to);
    const door = room.doors.find((d) => d.name === tr.toDoor);
    if (!door) throw new Error(`room "${tr.to}" has no door "${tr.toDoor}"`);
    const at = arrivalPoint(room, door);
    world.setPosition(state.playerId, at.x, at.y);
    world.setVelocity(state.playerId, 0, 0);
    next = {
      ...next,
      roomId: tr.to,
      room,
      nav: buildNavGrid(room),
      wallBodies: createWalls(world, room),
      lockBodies: [],
      locked: false,
      cleared: false,
    };
  }
  if (done) {
    if (next.clearedRooms.includes(next.roomId)) {
      next = { ...next, cleared: true };
    } else if (spawnRoomEntities(ecs, world, next.room)) {
      next = { ...next, locked: true, lockBodies: lockDoors(world, next.room) };
    }
  }
  syncSystem(ecs, world);
  return { ...next, player: snapshotOf(playerEntity(ecs)) };
}

/**
 * Plain, serialisable view of the state (everything that must match across replays).
 * Non-player entities are serialised sorted by id under `entities`; the key is omitted while
 * there are none, so a player-only world hashes exactly as it did before the ECS.
 */
export function stateSnapshot(state: SimState) {
  const others = entitiesById(state.ecs)
    .filter((e) => !e.player && isLive(e))
    .map((e) => ({
      id: e.id,
      position: e.position,
      velocity: e.velocity,
      hp: e.health?.hp ?? 0,
      iframes: e.iframes ?? 0,
      frozen: e.frozen ?? 0,
      ...(e.projectile ? { projectile: e.projectile.t } : {}),
      ...(e.ai ? { ai: { state: e.ai.state, t: e.ai.t, cooldown: e.ai.cooldown } } : {}),
    }));
  return {
    tick: state.tick,
    seed: state.seed,
    rng: state.rng.state,
    run: {
      room: state.roomId,
      cleared: state.clearedRooms,
      locked: state.locked,
      transition: state.transition,
    },
    player: state.player,
    ...(others.length > 0 ? { entities: others } : {}),
  };
}

export function hashSimState(state: SimState): string {
  return hashState(stateSnapshot(state));
}
