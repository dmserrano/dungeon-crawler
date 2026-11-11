/**
 * Engine-agnostic physics adapter (SPEC.md section 4, rule 3). Gameplay code depends on this
 * interface only; the Rapier implementation lives next to it and nothing else imports Rapier.
 */
export type BodyId = number;

export interface Vec2 {
  x: number;
  y: number;
}

export interface RaycastHit {
  body: BodyId;
  /** Distance along the (unit) direction. */
  toi: number;
  point: Vec2;
}

export interface CollisionEvent {
  a: BodyId;
  b: BodyId;
  started: boolean;
}

export type DebugShape =
  | { kind: "box"; x: number; y: number; hw: number; hh: number; dynamic: boolean }
  | { kind: "circle"; x: number; y: number; r: number; dynamic: boolean };

export interface PhysicsWorld {
  createStaticBox(x: number, y: number, halfW: number, halfH: number): BodyId;
  createDynamicCircle(x: number, y: number, radius: number): BodyId;
  /** Immovable solid circle (e.g. a training dummy). */
  createStaticCircle(x: number, y: number, radius: number): BodyId;
  /**
   * Moving sensor circle (e.g. a projectile): passes through everything and is never pushed.
   * Find what it overlaps with `intersectCircle`.
   */
  createSensorCircle(x: number, y: number, radius: number): BodyId;
  /** Teleport a body (velocity is kept). */
  setPosition(id: BodyId, x: number, y: number): void;
  /** Remove a body and its collider. Its id is never reused. */
  removeBody(id: BodyId): void;
  /** Instant velocity change of `impulse / mass`. No effect on static bodies. */
  applyImpulse(id: BodyId, ix: number, iy: number): void;
  getMass(id: BodyId): number;
  setVelocity(id: BodyId, vx: number, vy: number): void;
  getVelocity(id: BodyId): Vec2;
  getPosition(id: BodyId): Vec2;
  /** Advance by `dt` seconds. */
  step(dt: number): void;
  /** `dir` must be a unit vector. */
  raycast(origin: Vec2, dir: Vec2, maxDistance: number): RaycastHit | null;
  /** Bodies whose collider overlaps the circle (a sensor query: nothing is pushed). Sorted by id. */
  intersectCircle(x: number, y: number, radius: number): BodyId[];
  queryAABB(minX: number, minY: number, maxX: number, maxY: number): BodyId[];
  drainCollisionEvents(): CollisionEvent[];
  /** Collider outlines for the debug draw overlay. */
  debugShapes(): DebugShape[];
  bodyCount(): number;
}
