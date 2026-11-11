import { type Floor, floorSchema } from "../../../data/schemas/floor";
import type { Room } from "../room";

/** Convert untrusted floor JSON into a `Floor`. Throws a descriptive error. */
export function parseFloor(raw: unknown, name = "floor"): Floor {
  const parsed = floorSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid floor ${name}: ${parsed.error.message}`);
  return parsed.data;
}

/**
 * Graph check for a floor. `rooms` maps room id to its parsed room (a missing id means the room
 * failed to load or does not exist). Returns one message per violated rule; empty means valid.
 * Rules: every listed room loads, the start is listed, every door `to` and `toDoor` exists, links
 * are symmetric, and every room is reachable from the start.
 */
export function validateFloor(floor: Floor, rooms: ReadonlyMap<string, Room>): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const id of floor.rooms) {
    if (ids.has(id)) errors.push(`duplicate room "${id}"`);
    ids.add(id);
    if (!rooms.has(id)) errors.push(`room "${id}" does not load`);
  }
  if (!ids.has(floor.start)) errors.push(`start room "${floor.start}" is not listed in rooms`);

  const edges = new Map<string, Set<string>>();
  for (const id of ids) {
    const room = rooms.get(id);
    if (!room) continue;
    const out = new Set<string>();
    edges.set(id, out);
    for (const d of room.doors) {
      const target = ids.has(d.to) ? rooms.get(d.to) : undefined;
      if (!target) {
        errors.push(`${id}.${d.name}: target room "${d.to}" does not exist`);
        continue;
      }
      const back = target.doors.find((t) => t.name === d.toDoor);
      if (!back) {
        errors.push(`${id}.${d.name}: door "${d.toDoor}" does not exist in "${d.to}"`);
        continue;
      }
      if (back.to !== id || back.toDoor !== d.name) {
        errors.push(`${id}.${d.name}: link to ${d.to}.${d.toDoor} is not symmetric`);
      }
      out.add(d.to);
    }
  }

  const seen = new Set<string>();
  const queue = ids.has(floor.start) ? [floor.start] : [];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    for (const n of edges.get(id) ?? []) queue.push(n);
  }
  for (const id of ids) {
    if (!seen.has(id)) errors.push(`room "${id}" is not connected to the start`);
  }
  return errors;
}
