import type { InputFrame } from "./input-frame";
import type { BodyId, PhysicsWorld } from "./physics/physics-world";
import { createRng, type Rng } from "./rng/rng";
import { PLAYER_RADIUS, PLAYER_START, ROOM_WALLS } from "./room";
import { hashState } from "./state/hash";

export const TICK_RATE = 60;
export const TICK_DT = 1 / TICK_RATE;

const ACCEL = 1200; // px/s^2 while a direction is held
const DAMPING = 0.82; // per-tick velocity retention (manual linear damping)
const MAX_SPEED = 90; // px/s

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
  readonly playerId: BodyId;
  readonly player: PlayerSnapshot;
}

function snapshotPlayer(world: PhysicsWorld, id: BodyId): PlayerSnapshot {
  const p = world.getPosition(id);
  const v = world.getVelocity(id);
  return { x: p.x, y: p.y, vx: v.x, vy: v.y };
}

/** Build the initial state. `world` must be a fresh, empty physics world. */
export function createSimState(world: PhysicsWorld, seed: number): SimState {
  for (const w of ROOM_WALLS) world.createStaticBox(w.x, w.y, w.hw, w.hh);
  const playerId = world.createDynamicCircle(PLAYER_START.x, PLAYER_START.y, PLAYER_RADIUS);
  return {
    tick: 0,
    seed,
    rng: createRng(seed),
    world,
    playerId,
    player: snapshotPlayer(world, playerId),
  };
}

/**
 * Advance the world exactly one fixed tick: input -> movement -> physics step.
 * The physics world is mutated in place; the returned state holds the new snapshot.
 */
export function step(state: SimState, input: InputFrame): SimState {
  const { world, playerId } = state;
  const axisX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const axisY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const len = Math.hypot(axisX, axisY) || 1;

  const v = world.getVelocity(playerId);
  let vx = (v.x + (axisX / len) * ACCEL * TICK_DT) * DAMPING;
  let vy = (v.y + (axisY / len) * ACCEL * TICK_DT) * DAMPING;
  const speed = Math.hypot(vx, vy);
  if (speed > MAX_SPEED) {
    vx = (vx / speed) * MAX_SPEED;
    vy = (vy / speed) * MAX_SPEED;
  }
  world.setVelocity(playerId, vx, vy);
  world.step(TICK_DT);
  world.drainCollisionEvents(); // nothing consumes events yet; keep the queue empty

  return { ...state, tick: state.tick + 1, player: snapshotPlayer(world, playerId) };
}

/** Plain, serialisable view of the state (everything that must match across replays). */
export function stateSnapshot(state: SimState) {
  return { tick: state.tick, seed: state.seed, rng: state.rng.state, player: state.player };
}

export function hashSimState(state: SimState): string {
  return hashState(stateSnapshot(state));
}
