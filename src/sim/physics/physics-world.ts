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
  setVelocity(id: BodyId, vx: number, vy: number): void;
  getVelocity(id: BodyId): Vec2;
  getPosition(id: BodyId): Vec2;
  /** Advance by `dt` seconds. */
  step(dt: number): void;
  /** `dir` must be a unit vector. */
  raycast(origin: Vec2, dir: Vec2, maxDistance: number): RaycastHit | null;
  queryAABB(minX: number, minY: number, maxX: number, maxY: number): BodyId[];
  drainCollisionEvents(): CollisionEvent[];
  /** Collider outlines for the debug draw overlay. */
  debugShapes(): DebugShape[];
  bodyCount(): number;
}
