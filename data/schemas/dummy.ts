import { z } from "zod";

/** Training dummy: a solid, non-moving target. */
export const dummyDataSchema = z.strictObject({
  radius: z.number().positive(),
  hp: z.number().int().positive(),
  /** Invulnerability ticks granted after taking a hit. */
  invulnTicks: z.number().int().nonnegative(),
});

export type DummyData = z.infer<typeof dummyDataSchema>;
