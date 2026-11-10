import { describe, expect, it } from "vitest";
import {
  addComponent,
  createEcsWorld,
  createEntity,
  entitiesById,
  query,
  removeComponent,
  removeEntity,
} from "../src/sim/ecs/world";

describe("ecs", () => {
  it("assigns increasing stable ids and sorts by id", () => {
    const w = createEcsWorld();
    const a = createEntity(w);
    const b = createEntity(w);
    expect(b.id).toBe(a.id + 1);
    removeEntity(w, a);
    const c = createEntity(w);
    expect(c.id).toBe(b.id + 1);
    expect(entitiesById(w).map((e) => e.id)).toEqual([b.id, c.id]);
  });

  it("queries follow component add/remove", () => {
    const w = createEcsWorld();
    const e = createEntity(w);
    expect([...query(w, "velocity")]).toHaveLength(0);
    addComponent(w, e, "velocity", { x: 1, y: 2 });
    expect([...query(w, "velocity")]).toEqual([e]);
    removeComponent(w, e, "velocity");
    expect([...query(w, "velocity")]).toHaveLength(0);
  });
});
