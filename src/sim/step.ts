import { PLAYER_DATA } from "./data/player";
import {
  createEcsWorld,
  createEntity,
  type EcsWorld,
  type Entity,
  entitiesById,
  query,
} from "./ecs/world";
import type { InputFrame } from "./input-frame";
import type { BodyId, PhysicsWorld } from "./physics/physics-world";
import { createRng, type Rng } from "./rng/rng";
import { PLAYER_START, ROOM_WALLS } from "./room";
import { hashState } from "./state/hash";

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

export interface PlayerSnapshot {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface SimState {
  readonly tick: number;
  readonly seed: number;
  readonly rng: Rng;
  readonly world: PhysicsWorld;
  readonly ecs: EcsWorld;
  readonly playerId: BodyId;
  readonly player: PlayerSnapshot;
}

function snapshotOf(e: Entity): PlayerSnapshot {
  const { position: p, velocity: v } = e;
  return { x: p?.x ?? 0, y: p?.y ?? 0, vx: v?.x ?? 0, vy: v?.y ?? 0 };
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
  createEntity(ecs, { player: true, body: playerId, move: { x: 0, y: 0 } });
  syncSystem(ecs, world);
  return {
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
  for (const e of query(ecs, "player", "move")) e.move = { x: axisX, y: axisY };
}

function movementSystem(ecs: EcsWorld, world: PhysicsWorld): void {
  const { acceleration, damping, maxSpeed } = PLAYER_DATA;
  for (const e of query(ecs, "player", "body", "move")) {
    const len = Math.hypot(e.move.x, e.move.y) || 1;
    const v = world.getVelocity(e.body);
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
  const { world, ecs } = state;
  inputSystem(ecs, input);
  movementSystem(ecs, world);
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
    .map((e) => ({ id: e.id, position: e.position, velocity: e.velocity }));
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
