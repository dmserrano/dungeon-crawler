import { z } from "zod";

/** A floor names its start room and the ids (file names under `data/rooms/`) of all its rooms. */
export const floorSchema = z.object({
  start: z.string().min(1),
  rooms: z.array(z.string().min(1)).min(1),
});

export type Floor = z.infer<typeof floorSchema>;
