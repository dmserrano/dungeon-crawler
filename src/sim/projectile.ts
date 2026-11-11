import type { SimEvent } from "./combat";
import { RANGED_DATA } from "./data/enemies";
import { createEntity, type EcsWorld, type Entity, query } from "./ecs/world";
import type { PhysicsWorld, Vec2 } from "./physics/physics-world";

const P = RANGED_DATA.projectile;
/** Where inactive pooled projectiles wait, far outside the room. */
const PARK: Vec2 = { x: -1000, y: -1000 };

/** Create the fixed pool: one entity and one sensor body per slot, all parked and inactive. */
export function createProjectilePool(ecs: EcsWorld, world: PhysicsWorld): void {
  for (let i = 0; i < P.poolSize; i++) {
    createEntity(ecs, {
      projectile: { active: false, t: 0 },
      body: world.createSensorCircle(PARK.x, PARK.y, P.radius),
      position: { x: PARK.x, y: PARK.y },
      velocity: { x: 0, y: 0 },
      radius: P.radius,
    });
  }
}

function release(world: PhysicsWorld, p: Entity & Required<Pick<Entity, "projectile" | "body">>) {
  p.projectile.active = false;
  p.projectile.t = 0;
  world.setVelocity(p.body, 0, 0);
  world.setPosition(p.body, PARK.x, PARK.y);
}

/** Return every in-flight projectile to the pool (room transitions discard them). */
export function releaseAllProjectiles(ecs: EcsWorld, world: PhysicsWorld): void {
  for (const p of query(ecs, "projectile", "body")) if (p.projectile.active) release(world, p);
}

/** Number of projectiles currently in flight. */
export function activeProjectiles(ecs: EcsWorld): number {
  let n = 0;
  for (const p of query(ecs, "projectile")) if (p.projectile.active) n++;
  return n;
}

/**
 * Launches a pooled projectile from the shooter along the unit vector `dir`. Reuses the first
 * free slot (pool order is creation order, so this is deterministic). Returns false, firing
 * nothing, when every slot is in flight.
 */
export function fireProjectile(
  ecs: EcsWorld,
  world: PhysicsWorld,
  from: Vec2,
  shooterRadius: number,
  dir: Vec2,
): boolean {
  for (const p of query(ecs, "projectile", "body")) {
    if (p.projectile.active) continue;
    const offset = shooterRadius + P.radius + 1;
    p.projectile.active = true;
    p.projectile.t = 0;
    world.setPosition(p.body, from.x + dir.x * offset, from.y + dir.y * offset);
    world.setVelocity(p.body, dir.x * P.speed, dir.y * P.speed);
    return true;
  }
  return false;
}

/**
 * Ages projectiles and resolves their overlaps with the sensor query. The player takes damage
 * (and the projectile is consumed) unless dash or post-hit i-frames are active, in which case it
 * flies on through. Walls and the dummy destroy it; enemies and other projectiles are ignored,
 * and the swing never touches it (projectiles have no health). Lifetime expiry returns it to
 * the pool. The system itself allocates nothing while no projectile is in flight.
 */
export function projectileSystem(ecs: EcsWorld, world: PhysicsWorld, events: SimEvent[]): void {
  for (const p of query(ecs, "projectile", "body")) {
    if (!p.projectile.active) continue;
    if (++p.projectile.t >= P.lifetimeTicks) {
      release(world, p);
      continue;
    }
    const pos = world.getPosition(p.body);
    let hitPlayer: Entity | undefined;
    let hitSolid = false;
    for (const b of world.intersectCircle(pos.x, pos.y, P.radius)) {
      if (b === p.body) continue;
      let owner: Entity | undefined;
      for (const e of query(ecs, "body")) {
        if (e.body === b) owner = e;
      }
      if (!owner)
        hitSolid = true; // room walls have no entity
      else if (owner.player) hitPlayer = owner;
      else if (!owner.enemy && !owner.projectile) hitSolid = true; // the dummy
    }
    const target = hitPlayer;
    const vulnerable =
      target?.health !== undefined &&
      target.health.hp > 0 &&
      target.invulnerable !== true &&
      (target.iframes ?? 0) === 0;
    if (target && vulnerable) {
      const v = world.getVelocity(p.body);
      const len = Math.hypot(v.x, v.y) || 1;
      events.push({
        kind: "damage",
        target: target.id,
        source: p.id,
        amount: P.damage,
        knockback: { x: (v.x / len) * P.knockbackSpeed, y: (v.y / len) * P.knockbackSpeed },
        hitstop: P.hitstopTicks,
      });
      release(world, p);
    } else if (hitSolid) {
      release(world, p);
    }
  }
}
