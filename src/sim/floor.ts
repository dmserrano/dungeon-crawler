import { floorSchema } from "../../data/schemas/floor";
import type { Room } from "./room";

/** A floor: its id is the file name in `data/floors/`; `start` names the first room. */
export interface Floor {
  id: string;
  start: string;
}

/** Looks up a room by id (file name in `data/rooms/`). Throws on an unknown id. */
export type RoomSource = (id: string) => Room;

/** Convert untrusted floor JSON into a `Floor`. Pure: the caller reads the file. */
export function parseFloor(raw: unknown, id: string): Floor {
  const parsed = floorSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid floor ${id}: ${parsed.error.message}`);
  return { id, start: parsed.data.start };
}
