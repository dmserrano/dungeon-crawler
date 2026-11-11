import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import type {
  BodyId,
  CollisionEvent,
  DebugShape,
  PhysicsWorld,
  RaycastHit,
  Vec2,
} from "./physics-world";

let initPromise: Promise<void> | null = null;

/** The single place Rapier's WASM is initialised. Await before calling `createRapierWorld`. */
export function initPhysics(): Promise<void> {
  initPromise ??= RAPIER.init();
  return initPromise;
}

export function createRapierWorld(): PhysicsWorld {
  const world = new RAPIER.World({ x: 0, y: 0 });
  const events = new RAPIER.EventQueue(true);
  const bodies: (RAPIER.RigidBody | undefined)[] = [];
  const colliders: number[] = [];
  let live = 0;
  const dynamic = new Set<BodyId>();
  const byCollider = new Map<number, BodyId>();

  const register = (body: RAPIER.RigidBody, collider: RAPIER.Collider, isDynamic: boolean) => {
    const id = bodies.length;
    bodies.push(body);
    colliders.push(collider.handle);
    live++;
    byCollider.set(collider.handle, id);
    if (isDynamic) dynamic.add(id);
    return id;
  };
  const body = (id: BodyId) => {
    const b = bodies[id];
    if (!b) throw new Error(`Unknown body ${id}`);
    return b;
  };

  return {
    createStaticBox(x, y, halfW, halfH) {
      const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y));
      const col = world.createCollider(
        RAPIER.ColliderDesc.cuboid(halfW, halfH).setActiveEvents(
          RAPIER.ActiveEvents.COLLISION_EVENTS,
        ),
        rb,
      );
      return register(rb, col, false);
    },
    createDynamicCircle(x, y, radius) {
      // Damping is applied manually by the sim, so the engine's is left at zero.
      const rb = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).setLinearDamping(0).lockRotations(),
      );
      const col = world.createCollider(
        RAPIER.ColliderDesc.ball(radius)
          .setRestitution(0)
          .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        rb,
      );
      return register(rb, col, true);
    },
    createStaticCircle(x, y, radius) {
      const rb = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y));
      const col = world.createCollider(
        RAPIER.ColliderDesc.ball(radius).setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
        rb,
      );
      return register(rb, col, false);
    },
    createSensorCircle(x, y, radius) {
      const rb = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y).setLinearDamping(0).lockRotations(),
      );
      const col = world.createCollider(RAPIER.ColliderDesc.ball(radius).setSensor(true), rb);
      return register(rb, col, true);
    },
    setPosition(id, x, y) {
      body(id).setTranslation({ x, y }, true);
    },
    removeBody(id) {
      const b = bodies[id];
      if (!b) return;
      world.removeRigidBody(b);
      byCollider.delete(colliders[id] as number);
      dynamic.delete(id);
      bodies[id] = undefined;
      live--;
    },
    applyImpulse(id, ix, iy) {
      body(id).applyImpulse({ x: ix, y: iy }, true);
    },
    getMass(id) {
      return body(id).mass();
    },
    intersectCircle(x, y, radius) {
      const out: BodyId[] = [];
      world.intersectionsWithShape({ x, y }, 0, new RAPIER.Ball(radius), (c) => {
        const id = byCollider.get(c.handle);
        if (id !== undefined) out.push(id);
        return true;
      });
      return out.sort((a, b) => a - b);
    },
    setVelocity(id, vx, vy) {
      body(id).setLinvel({ x: vx, y: vy }, true);
    },
    getVelocity(id) {
      const v = body(id).linvel();
      return { x: v.x, y: v.y };
    },
    getPosition(id) {
      const p = body(id).translation();
      return { x: p.x, y: p.y };
    },
    step(dt) {
      world.timestep = dt;
      world.step(events);
    },
    raycast(origin: Vec2, dir: Vec2, maxDistance: number): RaycastHit | null {
      const hit = world.castRay(new RAPIER.Ray(origin, dir), maxDistance, true);
      if (!hit) return null;
      const id = byCollider.get(hit.collider.handle);
      if (id === undefined) return null;
      return {
        body: id,
        toi: hit.timeOfImpact,
        point: { x: origin.x + dir.x * hit.timeOfImpact, y: origin.y + dir.y * hit.timeOfImpact },
      };
    },
    queryAABB(minX, minY, maxX, maxY) {
      const out: BodyId[] = [];
      world.collidersWithAabbIntersectingAabb(
        { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        { x: (maxX - minX) / 2, y: (maxY - minY) / 2 },
        (c) => {
          const id = byCollider.get(c.handle);
          if (id !== undefined) out.push(id);
          return true;
        },
      );
      return out.sort((a, b) => a - b);
    },
    drainCollisionEvents() {
      const out: CollisionEvent[] = [];
      events.drainCollisionEvents((h1, h2, started) => {
        const a = byCollider.get(h1);
        const b = byCollider.get(h2);
        if (a !== undefined && b !== undefined) out.push({ a, b, started });
      });
      return out;
    },
    debugShapes() {
      const shapes: DebugShape[] = [];
      world.colliders.forEach((c) => {
        const t = c.translation();
        const isDynamic = dynamic.has(byCollider.get(c.handle) ?? -1);
        const half = c.halfExtents();
        if (half) {
          shapes.push({ kind: "box", x: t.x, y: t.y, hw: half.x, hh: half.y, dynamic: isDynamic });
        } else {
          shapes.push({ kind: "circle", x: t.x, y: t.y, r: c.radius() ?? 0, dynamic: isDynamic });
        }
      });
      return shapes;
    },
    bodyCount() {
      return live;
    },
  };
}
