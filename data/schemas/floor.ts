import { z } from "zod";

/** A floor file (`data/floors/<id>.json`): names the room a run starts in. */
export const floorSchema = z.object({
  /** Id of a room in `data/rooms/` (file name without `.tmj`). */
  start: z.string().min(1),
});
