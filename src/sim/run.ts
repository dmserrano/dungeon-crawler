import { spawnEnemy } from "./ai/system";
import { DUMMY_DATA } from "./data/dummy";
import {
  createEntity,
  type EcsWorld,
  type Entity,
  query,
  removeComponent,
  removeEntity,
} from "./ecs/world";
import type { BodyId, PhysicsWorld } from "./physics/physics-world";
import { releaseAllProjectiles } from "./projectile";
import type { DoorSpawn, Point, Room } from "./room";

/** Total transition length in ticks; the old room is swapped for the new one at the midpoint. */
export const TRANSITION_TICKS = 20;
export const TRANSITION_MIDPOINT = TRANSITION_TICKS / 2;
/** The player triggers a door when closer than this to the door point (px, centre to centre). */
const DOOR_TOUCH_RADIUS = 14;
/** Half size of the static box that blocks a locked door. */
const DOOR_LOCK_HALF = 8;
/** How far inward of the paired door the player arrives. */
const ARRIVAL_NUDGE = 24;

/** A door transition in progress. The renderer fades from this; it never owns the timing. */
export interface Transition {
  /** Ticks elapsed (0 on the tick the door was touched). */
  t: number;
  /** Id of the room being entered and the name of the door the player arrives at. */
  to: string;
  toDoor: string;
}

/** Fade opacity 0-1 for a transition (0 = clear, 1 = black at the midpoint); render-only. */
export function transitionFade(t: Transition | null): number {
  if (!t) return 0;
  return 1 - Math.abs(t.t - TRANSITION_MIDPOINT) / TRANSITION_MIDPOINT;
}

/** The door the player is touching, if any (first in room order). */
export function touchedDoor(room: Room, player: Point, playerRadius: number): DoorSpawn | null {
  for (const d of room.doors) {
    if (Math.hypot(d.x - player.x, d.y - player.y) < DOOR_TOUCH_RADIUS + playerRadius) return d;
  }
  return null;
}

export function createWalls(world: PhysicsWorld, room: Room): BodyId[] {
  return room.walls.map((w) => world.createStaticBox(w.x, w.y, w.hw, w.hh));
}

/** Spawn the dummy and enemies. Returns true when something hostile now exists. */
export function spawnRoomEntities(ecs: EcsWorld, world: PhysicsWorld, room: Room): boolean {
  if (room.dummy) {
    createEntity(ecs, {
      dummy: true,
      body: world.createStaticCircle(room.dummy.x, room.dummy.y, DUMMY_DATA.radius),
      health: { hp: DUMMY_DATA.hp, max: DUMMY_DATA.hp, iframeTicks: DUMMY_DATA.invulnTicks },
      radius: DUMMY_DATA.radius,
      position: { x: room.dummy.x, y: room.dummy.y },
    });
  }
  let hostile = room.dummy !== null;
  for (const e of room.enemies) {
    if (e.type !== "chaser" && e.type !== "ranged") continue;
    spawnEnemy(ecs, world, e.type, e.x, e.y);
    hostile = true;
  }
  return hostile;
}

export function lockDoors(world: PhysicsWorld, room: Room): BodyId[] {
  return room.doors.map((d) => world.createStaticBox(d.x, d.y, DOOR_LOCK_HALF, DOOR_LOCK_HALF));
}

export function unlockDoors(world: PhysicsWorld, bodies: readonly BodyId[]): void {
  for (const b of bodies) world.removeBody(b);
}

/** Stop whatever the player was doing so the transition starts from rest. */
export function haltPlayer(ecs: EcsWorld, world: PhysicsWorld): void {
  for (const e of query(ecs, "player", "body")) {
    for (const key of [
      "dash",
      "invulnerable",
      "attack",
      "stagger",
      "knockback",
      "frozen",
    ] as const) {
      if (e[key] !== undefined) removeComponent(ecs, e, key);
    }
    world.setVelocity(e.body, 0, 0);
  }
}

/**
 * Tear down the old room: enemies, the dummy, projectiles in flight and the room's static
 * bodies (walls and any door locks). The player and the projectile pool stay.
 */
export function teardownRoom(
  ecs: EcsWorld,
  world: PhysicsWorld,
  staticBodies: readonly BodyId[],
): void {
  releaseAllProjectiles(ecs, world);
  const gone: Entity[] = [];
  for (const e of query(ecs, "body")) if (!e.player && !e.projectile) gone.push(e);
  for (const e of gone) {
    world.removeBody(e.body as BodyId);
    removeEntity(ecs, e);
  }
  for (const b of staticBodies) world.removeBody(b);
}

/** Where the player arrives: the paired door, nudged toward the room centre along its main axis. */
export function arrivalPoint(room: Room, door: DoorSpawn): Point {
  const dx = room.width / 2 - door.x;
  const dy = room.height / 2 - door.y;
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: door.x + Math.sign(dx || 1) * ARRIVAL_NUDGE, y: door.y }
    : { x: door.x, y: door.y + Math.sign(dy) * ARRIVAL_NUDGE };
}
