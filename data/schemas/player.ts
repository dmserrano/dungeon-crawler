import { z } from "zod";

/** Player tuning. Units: px, px/s, px/s^2; damping is per-tick velocity retention. */
export const playerDataSchema = z.strictObject({
  radius: z.number().positive(),
  maxSpeed: z.number().positive(),
  acceleration: z.number().positive(),
  damping: z.number().gt(0).lte(1),
});

export type PlayerData = z.infer<typeof playerDataSchema>;
