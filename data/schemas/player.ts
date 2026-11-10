import { z } from "zod";

/** Dash tuning. Distance in px; the rest in sim ticks (60 Hz). */
const dashDataSchema = z
  .strictObject({
    distance: z.number().positive(),
    ticks: z.number().int().positive(),
    iframeTicks: z.number().int().nonnegative(),
    cooldownTicks: z.number().int().nonnegative(),
  })
  .refine((d) => d.iframeTicks <= d.ticks, {
    message: "iframeTicks must not exceed ticks",
    path: ["iframeTicks"],
  });

/** Player tuning. Units: px, px/s, px/s^2; damping is per-tick velocity retention. */
export const playerDataSchema = z.strictObject({
  radius: z.number().positive(),
  maxSpeed: z.number().positive(),
  acceleration: z.number().positive(),
  damping: z.number().gt(0).lte(1),
  dash: dashDataSchema,
});

export type PlayerData = z.infer<typeof playerDataSchema>;
