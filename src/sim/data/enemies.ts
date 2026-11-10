import enemiesJson from "../../../data/enemies.json";
import { type EnemiesData, enemiesDataSchema } from "../../../data/schemas/enemies";

/** Parse untrusted enemy data; throws a descriptive error when invalid. */
export function parseEnemiesData(raw: unknown): EnemiesData {
  const result = enemiesDataSchema.safeParse(raw);
  if (!result.success) throw new Error(`invalid data/enemies.json: ${result.error.message}`);
  return result.data;
}

export const CHASER_DATA = parseEnemiesData(enemiesJson).chaser;
