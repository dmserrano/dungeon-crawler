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

/** Melee swing tuning. Phases and stagger in ticks, distances in px, speeds in px/s. */
const attackDataSchema = z.strictObject({
  windupTicks: z.number().int().nonnegative(),
  activeTicks: z.number().int().positive(),
  recoveryTicks: z.number().int().nonnegative(),
  damage: z.number().int().positive(),
  /** Distance from the player centre to the hitbox centre, along aim. */
  reach: z.number().nonnegative(),
  hitRadius: z.number().positive(),
  /** Velocity change a hit gives the target, away from the attacker. */
  knockbackSpeed: z.number().nonnegative(),
  hitstopTicks: z.number().int().nonnegative(),
  /** Ticks a knocked-back entity ignores movement input after hitstop. */
  staggerTicks: z.number().int().nonnegative(),
  /** Movement speed multiplier during a swing. */
  moveScale: z.number().gt(0).lte(1),
});

/** Player tuning. Units: px, px/s, px/s^2; damping is per-tick velocity retention. */
export const playerDataSchema = z.strictObject({
  radius: z.number().positive(),
  maxSpeed: z.number().positive(),
  acceleration: z.number().positive(),
  damping: z.number().gt(0).lte(1),
  hp: z.number().int().positive(),
  /** Invulnerability ticks granted after taking a hit. */
  invulnTicks: z.number().int().nonnegative(),
  dash: dashDataSchema,
  attack: attackDataSchema,
});

export type PlayerData = z.infer<typeof playerDataSchema>;
