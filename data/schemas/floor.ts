import { z } from "zod";

/** A floor file (`data/floors/<id>.json`): names the room a run starts in and lists its rooms. */
export const floorSchema = z.object({
  /** Id of a room in `data/rooms/` (file name without `.tmj`). */
  start: z.string().min(1),
  /** Ids of every room on the floor. Defaults to just the start room. */
  rooms: z.array(z.string().min(1)).optional(),
});
