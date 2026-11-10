import { World } from "miniplex";
import type { BodyId } from "../physics/physics-world";

/** Components. Every entity has a stable numeric `id` from the world's counter. */
export interface Entity {
  id: number;
  player?: true;
  body?: BodyId;
  position?: { x: number; y: number };
  velocity?: { x: number; y: number };
  /** Movement intent for this tick, set by the input system. */
  move?: { x: number; y: number };
  /** This tick's aim (0-255), attack and dash buttons, set by the input system. */
  buttons?: { aim: number; attack: boolean; dash: boolean };
  /** Active dash: unit direction and how many dash ticks have run so far. */
  dash?: { dx: number; dy: number; elapsed: number };
  /** Ticks until the next dash is allowed. */
  dashCooldown?: number;
  /** Invulnerability frames flag; consumed later by damage. */
  invulnerable?: true;
}

type ComponentKey = keyof Omit<Entity, "id">;

/** Thin boundary over miniplex: the only module that imports it. */
export interface EcsWorld {
  nextId: number;
  readonly inner: World<Entity>;
}

export function createEcsWorld(): EcsWorld {
  return { nextId: 1, inner: new World<Entity>() };
}

export function createEntity(w: EcsWorld, components: Omit<Entity, "id"> = {}): Entity {
  return w.inner.add({ ...components, id: w.nextId++ });
}

export function removeEntity(w: EcsWorld, e: Entity): void {
  w.inner.remove(e);
}

export function addComponent<K extends ComponentKey>(
  w: EcsWorld,
  e: Entity,
  key: K,
  value: NonNullable<Entity[K]>,
): void {
  w.inner.addComponent(e, key, value);
}

export function removeComponent(w: EcsWorld, e: Entity, key: ComponentKey): void {
  w.inner.removeComponent(e, key);
}

/** Entities having all of `keys`. */
export function query<K extends keyof Entity>(
  w: EcsWorld,
  ...keys: K[]
): Iterable<Entity & Required<Pick<Entity, K>>> {
  return w.inner.with(...keys).entities as Iterable<Entity & Required<Pick<Entity, K>>>;
}

/** All entities sorted by id (the canonical order for snapshots). */
export function entitiesById(w: EcsWorld): Entity[] {
  return [...w.inner.entities].sort((a, b) => a.id - b.id);
}
