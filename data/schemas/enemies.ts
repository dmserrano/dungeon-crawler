import { z } from "zod";

/**
 * Chaser enemy. Distances in px, speeds in px/s, durations in sim ticks (60 Hz).
 * The whole behavior (chase, telegraph, lunge, stagger) is described by this data.
 */
const chaserDataSchema = z
  .strictObject({
    radius: z.number().positive(),
    hp: z.number().int().positive(),
    /** Invulnerability ticks granted after taking a hit. */
    invulnTicks: z.number().int().nonnegative(),
    /** Chase speed. */
    speed: z.number().positive(),
    /** Per-tick velocity retention while knocked back. */
    damping: z.number().gt(0).lte(1),
    /** Distance at which an idle chaser notices the player. */
    aggroRange: z.number().positive(),
    /** Centre distance at which a chasing enemy starts its telegraph. */
    attackRange: z.number().positive(),
    /** Ticks of warning (standing still) before the lunge. */
    telegraphTicks: z.number().int().positive(),
    lunge: z.strictObject({
      speed: z.number().positive(),
      ticks: z.number().int().positive(),
    }),
    /** Ticks after a lunge or stagger before the next telegraph is allowed. */
    cooldownTicks: z.number().int().nonnegative(),
    contactDamage: z.number().int().positive(),
    /** Velocity change a lunge hit gives the player, away from the enemy. */
    knockbackSpeed: z.number().nonnegative(),
    /** Ticks both parties freeze for when the lunge connects. */
    hitstopTicks: z.number().int().nonnegative(),
    /** Ticks the enemy is staggered after being hit (after hitstop). */
    staggerTicks: z.number().int().nonnegative(),
    /** Enemies closer than this push each other apart. */
    separationRadius: z.number().positive(),
    /** Strength of that push relative to the steering toward the player. */
    separationWeight: z.number().nonnegative(),
  })
  .refine((d) => d.attackRange < d.aggroRange, {
    message: "attackRange must be smaller than aggroRange",
    path: ["attackRange"],
  });

export const enemiesDataSchema = z.strictObject({
  chaser: chaserDataSchema,
});

export type EnemiesData = z.infer<typeof enemiesDataSchema>;
export type ChaserData = EnemiesData["chaser"];
