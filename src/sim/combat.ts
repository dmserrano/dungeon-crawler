import { PLAYER_DATA } from "./data/player";
import {
  addComponent,
  type EcsWorld,
  type Entity,
  query,
  removeComponent,
  removeEntity,
} from "./ecs/world";
import { aimToDir } from "./input-frame";
import type { BodyId, PhysicsWorld } from "./physics/physics-world";

/** Events flow through one queue per tick: systems push, `damageSystem` consumes in order. */
export type SimEvent =
  | {
      kind: "damage";
      /** Entity id of the victim and of the attacker (null for environmental damage). */
      target: number;
      source: number | null;
      amount: number;
      /** Velocity change (px/s) given to the victim once hitstop ends. Zero for none. */
      knockback: { x: number; y: number };
      /** Ticks both parties freeze for. */
      hitstop: number;
    }
  | { kind: "death"; id: number };

export type AttackPhase = "windup" | "active" | "recovery";

const A = PLAYER_DATA.attack;
export const ATTACK_TOTAL_TICKS = A.windupTicks + A.activeTicks + A.recoveryTicks;

/** Phase of a swing `t` ticks after it started, or null once it is over. */
export function attackPhaseAt(t: number): AttackPhase | null {
  if (t < A.windupTicks) return "windup";
  if (t < A.windupTicks + A.activeTicks) return "active";
  if (t < ATTACK_TOTAL_TICKS) return "recovery";
  return null;
}

/** Queue damage from outside the combat systems (hazards, tests). */
export function queueDamage(events: SimEvent[], target: number, amount: number): void {
  events.push({
    kind: "damage",
    target,
    source: null,
    amount,
    knockback: { x: 0, y: 0 },
    hitstop: 0,
  });
}

export const isFrozen = (e: Entity): boolean => (e.frozen ?? 0) > 0;

/** Counts down post-hit invulnerability, then releases entities whose hitstop has ended. */
export function releaseSystem(ecs: EcsWorld, world: PhysicsWorld): void {
  for (const e of [...query(ecs, "iframes")]) {
    if (e.iframes > 0) e.iframes--;
    if (e.iframes === 0) removeComponent(ecs, e, "iframes");
  }
  for (const e of [...query(ecs, "frozen")]) {
    if (e.frozen > 0) continue;
    removeComponent(ecs, e, "frozen");
    const k = e.knockback;
    if (!k) continue;
    removeComponent(ecs, e, "knockback");
    if (e.body !== undefined) {
      const m = world.getMass(e.body);
      world.applyImpulse(e.body, k.x * m, k.y * m);
      addComponent(ecs, e, "stagger", e.staggerTicks ?? A.staggerTicks);
    }
  }
}

/** Holds frozen entities in place and counts the hitstop down. Runs just before the physics step. */
export function freezeSystem(ecs: EcsWorld, world: PhysicsWorld): void {
  for (const e of query(ecs, "frozen")) {
    if (e.frozen <= 0) continue;
    if (e.body !== undefined) world.setVelocity(e.body, 0, 0);
    e.frozen--;
  }
}

/** Add or overwrite a component (plain assignment would not update ECS queries). */
function setComponent<K extends "iframes" | "frozen" | "knockback">(
  ecs: EcsWorld,
  e: Entity,
  key: K,
  value: NonNullable<Entity[K]>,
): void {
  if (e[key] === undefined) addComponent(ecs, e, key, value);
  else e[key] = value;
}

function freeze(ecs: EcsWorld, e: Entity, ticks: number): void {
  setComponent(ecs, e, "frozen", Math.max(e.frozen ?? 0, ticks));
}

function entityByBody(ecs: EcsWorld): Map<BodyId, Entity> {
  const m = new Map<BodyId, Entity>();
  for (const e of query(ecs, "body", "health")) m.set(e.body, e);
  return m;
}

/**
 * Drives the player's swing: starts it on the attack button, advances windup, active and
 * recovery, and during the active phase queries a circular sensor ahead of the player. Each
 * entity is hit at most once per swing. Dashing cancels a swing.
 */
export function meleeSystem(ecs: EcsWorld, world: PhysicsWorld, events: SimEvent[]): void {
  for (const e of query(ecs, "player", "body", "position", "buttons")) {
    if (isFrozen(e)) continue;
    if (e.dash) {
      if (e.attack) removeComponent(ecs, e, "attack");
      continue;
    }
    if (e.attack && attackPhaseAt(e.attack.t) === null) removeComponent(ecs, e, "attack");
    if (!e.attack && e.buttons.attack) {
      addComponent(ecs, e, "attack", { t: 0, aim: e.buttons.aim, hit: [] });
    }
    const swing = e.attack;
    if (!swing) continue;
    if (attackPhaseAt(swing.t) === "active") {
      const dir = aimToDir(swing.aim);
      const cx = e.position.x + dir.x * A.reach;
      const cy = e.position.y + dir.y * A.reach;
      const bodies = entityByBody(ecs);
      const targets: Entity[] = [];
      for (const b of world.intersectCircle(cx, cy, A.hitRadius)) {
        const t = bodies.get(b);
        if (t && t !== e && !swing.hit.includes(t.id)) targets.push(t);
      }
      targets.sort((p, q) => p.id - q.id);
      for (const t of targets) {
        swing.hit.push(t.id);
        let dx = (t.position?.x ?? e.position.x) - e.position.x;
        let dy = (t.position?.y ?? e.position.y) - e.position.y;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          dx /= len;
          dy /= len;
        } else {
          dx = dir.x;
          dy = dir.y;
        }
        events.push({
          kind: "damage",
          target: t.id,
          source: e.id,
          amount: A.damage,
          knockback: { x: dx * A.knockbackSpeed, y: dy * A.knockbackSpeed },
          hitstop: A.hitstopTicks,
        });
      }
    }
    swing.t++;
  }
}

/**
 * Applies queued damage. Dash i-frames and post-hit invulnerability both block it. A landed hit
 * grants i-frames, queues knockback and freezes victim and attacker. HP 0 kills: non-player
 * entities are removed (body included); the player stays so the sim can stop and report it.
 */
export function damageSystem(ecs: EcsWorld, world: PhysicsWorld, events: SimEvent[]): void {
  const byId = new Map<number, Entity>();
  for (const e of query(ecs, "health")) byId.set(e.id, e);
  const n = events.length;
  for (let i = 0; i < n; i++) {
    const ev = events[i];
    if (ev?.kind !== "damage") continue;
    const target = byId.get(ev.target);
    if (!target?.health || target.health.hp <= 0) continue;
    if (target.invulnerable || (target.iframes ?? 0) > 0) continue;
    target.health.hp = Math.max(0, target.health.hp - ev.amount);
    if (target.health.iframeTicks > 0) {
      setComponent(ecs, target, "iframes", target.health.iframeTicks);
    }
    if (ev.hitstop > 0) {
      freeze(ecs, target, ev.hitstop);
      const src = ev.source === null ? undefined : byId.get(ev.source);
      if (src) freeze(ecs, src, ev.hitstop);
      if (ev.knockback.x !== 0 || ev.knockback.y !== 0) {
        setComponent(ecs, target, "knockback", ev.knockback);
      }
    }
    if (target.health.hp === 0) {
      events.push({ kind: "death", id: target.id });
      if (!target.player) {
        byId.delete(target.id);
        if (target.body !== undefined) world.removeBody(target.body);
        removeEntity(ecs, target);
      }
    }
  }
  events.splice(0, n); // processed damage is consumed; death notices stay for this tick
}
