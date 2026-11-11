import { floorSchema } from "../../data/schemas/floor";
import type { Room } from "./room";

/** A floor: its id is the file name in `data/floors/`; `start` names the first room. */
export interface Floor {
  id: string;
  start: string;
  /** Ids of every room on the floor (the start room is always included). */
  rooms: readonly string[];
}

/** Looks up a room by id (file name in `data/rooms/`). Throws on an unknown id. */
export type RoomSource = (id: string) => Room;

/** Convert untrusted floor JSON into a `Floor`. Pure: the caller reads the file. */
export function parseFloor(raw: unknown, id: string): Floor {
  const parsed = floorSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid floor ${id}: ${parsed.error.message}`);
  return { id, start: parsed.data.start, rooms: parsed.data.rooms ?? [parsed.data.start] };
}

/**
 * Check a floor and return every problem found (empty = valid): each room loads, the start is
 * listed, every door target exists, links are symmetric and all rooms are reachable from the start.
 */
export function validateFloor(floor: Floor, rooms: RoomSource): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const id of floor.rooms) {
    if (ids.has(id)) errors.push(`duplicate room "${id}"`);
    ids.add(id);
  }
  if (!ids.has(floor.start)) errors.push(`start room "${floor.start}" is not listed in rooms`);

  const loaded = new Map<string, Room>();
  for (const id of ids) {
    try {
      loaded.set(id, rooms(id));
    } catch (e) {
      errors.push(`room "${id}" does not load: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  for (const [id, room] of loaded) {
    for (const d of room.doors) {
      const target = loaded.get(d.to);
      if (!target) {
        errors.push(`room "${id}" door "${d.name}" leads to unknown room "${d.to}"`);
        continue;
      }
      const back = target.doors.find((t) => t.name === d.toDoor);
      if (!back) {
        errors.push(`room "${id}" door "${d.name}" targets missing door "${d.to}.${d.toDoor}"`);
      } else if (back.to !== id || back.toDoor !== d.name) {
        errors.push(
          `link "${id}.${d.name}" -> "${d.to}.${d.toDoor}" is not symmetric (it points back to "${back.to}.${back.toDoor}")`,
        );
      }
    }
  }

  const seen = new Set<string>();
  const queue = loaded.has(floor.start) ? [floor.start] : [];
  for (let id = queue.pop(); id !== undefined; id = queue.pop()) {
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of loaded.get(id)?.doors ?? []) if (loaded.has(d.to)) queue.push(d.to);
  }
  for (const id of loaded.keys()) {
    if (!seen.has(id)) errors.push(`room "${id}" is not connected to the start room`);
  }
  return errors;
}
