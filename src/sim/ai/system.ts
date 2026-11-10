import { isFrozen, type SimEvent } from "../combat";
import { CHASER_DATA } from "../data/enemies";
import { createEntity, type EcsWorld, type Entity, query, removeComponent } from "../ecs/world";
import type { BodyId, PhysicsWorld, Vec2 } from "../physics/physics-world";
import { type AiSense, newAiMemory, nextAiState } from "./chaser";

const D = CHASER_DATA;

/** Spawn a chaser at a fixed position. Fully described by `data/enemies.json`. */
export function spawnChaser(ecs: EcsWorld, world: PhysicsWorld, x: number, y: number): Entity {
  return createEntity(ecs, {
    enemy: true,
    body: world.createDynamicCircle(x, y, D.radius),
    position: { x, y },
    velocity: { x: 0, y: 0 },
    health: { hp: D.hp, max: D.hp, iframeTicks: D.invulnTicks },
    radius: D.radius,
    staggerTicks: D.staggerTicks,
    ai: newAiMemory(),
  });
}

const ZERO: Vec2 = { x: 0, y: 0 };
/** How far ahead (px beyond the body edge) wall avoidance looks. */
const LOOKAHEAD = 14;
/** Steering candidates tried in order: straight, then 45 and 90 degrees to either side. */
const TURNS: readonly Vec2[] = [
  { x: 1, y: 0 },
  { x: Math.SQRT1_2, y: Math.SQRT1_2 },
  { x: Math.SQRT1_2, y: -Math.SQRT1_2 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const rotate = (d: Vec2, t: Vec2): Vec2 => ({ x: d.x * t.x - d.y * t.y, y: d.x * t.y + d.y * t.x });

function normalize(v: Vec2): Vec2 {
  const len = Math.hypot(v.x, v.y);
  return len > 0 ? { x: v.x / len, y: v.y / len } : ZERO;
}

/**
 * Direct steering toward the player, plus a soft push away from nearby chasers, then simple wall
 * avoidance: raycast ahead through the adapter and turn to the first clear candidate (ADR 0004).
 * `ignore` holds bodies that are not obstacles (the player and other enemies).
 */
export function steer(
  e: Entity & Required<Pick<Entity, "position" | "radius">>,
  body: BodyId,
  toPlayer: Vec2,
  others: readonly Entity[],
  world: PhysicsWorld,
  ignore: ReadonlySet<BodyId>,
): Vec2 {
  let x = toPlayer.x;
  let y = toPlayer.y;
  for (const o of others) {
    if (o === e || !o.position) continue;
    const dx = e.position.x - o.position.x;
    const dy = e.position.y - o.position.y;
    const d = Math.hypot(dx, dy);
    if (d >= D.separationRadius) continue;
    // Exactly overlapping enemies are split along an id-dependent axis so it stays deterministic.
    const away = d > 0 ? { x: dx / d, y: dy / d } : { x: e.id < o.id ? -1 : 1, y: 0 };
    const w = (1 - d / D.separationRadius) * D.separationWeight;
    x += away.x * w;
    y += away.y * w;
  }
  const desired = normalize({ x, y });
  if (desired === ZERO) return ZERO;
  for (const t of TURNS) {
    const dir = rotate(desired, t);
    const origin = {
      x: e.position.x + dir.x * (e.radius + 0.1),
      y: e.position.y + dir.y * (e.radius + 0.1),
    };
    const hit = world.raycast(origin, dir, LOOKAHEAD);
    if (!hit || ignore.has(hit.body) || hit.body === body) return dir;
  }
  return desired;
}

/**
 * Runs every enemy's state machine and applies its movement. A hit (pending knockback or
 * stagger from the combat systems) interrupts into stagger. Contact damage is queued as a
 * damage event only while lunging, at most once per lunge, and never into i-frames.
 */
export function aiSystem(ecs: EcsWorld, world: PhysicsWorld, events: SimEvent[]): void {
  let player: (Entity & Required<Pick<Entity, "position" | "radius">>) | undefined;
  for (const p of query(ecs, "player", "position", "radius")) player = p;
  const enemies = [...query(ecs, "enemy", "ai", "body", "position", "radius", "health")].sort(
    (a, b) => a.id - b.id,
  );
  const ignore = new Set<BodyId>(enemies.map((e) => e.body));
  if (player?.body !== undefined) ignore.add(player.body);

  for (const e of enemies) {
    const interrupted = e.knockback !== undefined || e.stagger !== undefined;
    const frozen = isFrozen(e);
    if (frozen && !interrupted) continue; // hitstop (e.g. after landing a lunge)

    const dx = (player?.position.x ?? 0) - e.position.x;
    const dy = (player?.position.y ?? 0) - e.position.y;
    const dist = player ? Math.hypot(dx, dy) : Number.POSITIVE_INFINITY;
    const sense: AiSense = {
      dist,
      toPlayer: player ? normalize({ x: dx, y: dy }) : ZERO,
      staggered: interrupted,
      dead: e.health.hp <= 0,
    };
    const ai = nextAiState(e.ai, sense, D);
    e.ai = ai;
    if (frozen) continue; // hitstop holds the body; the state already switched to stagger

    switch (ai.state) {
      case "idle":
      case "dead":
      case "telegraph":
        world.setVelocity(e.body, 0, 0);
        break;
      case "chase": {
        const dir = steer(e, e.body, sense.toPlayer, enemies, world, ignore);
        world.setVelocity(e.body, dir.x * D.speed, dir.y * D.speed);
        break;
      }
      case "attack": {
        world.setVelocity(e.body, ai.dir.x * D.lunge.speed, ai.dir.y * D.lunge.speed);
        const vulnerable = player?.invulnerable !== true && (player?.iframes ?? 0) === 0;
        if (player && !ai.spent && vulnerable && dist <= e.radius + player.radius + 1) {
          ai.spent = true;
          events.push({
            kind: "damage",
            target: player.id,
            source: e.id,
            amount: D.contactDamage,
            knockback: {
              x: sense.toPlayer.x * D.knockbackSpeed,
              y: sense.toPlayer.y * D.knockbackSpeed,
            },
            hitstop: D.hitstopTicks,
          });
        }
        break;
      }
      case "stagger": {
        // Knockback is not clipped by a speed cap: only damped, like the player's.
        const v = world.getVelocity(e.body);
        world.setVelocity(e.body, v.x * D.damping, v.y * D.damping);
        if (e.stagger !== undefined && --e.stagger <= 0) removeComponent(ecs, e, "stagger");
        break;
      }
    }
  }
}
