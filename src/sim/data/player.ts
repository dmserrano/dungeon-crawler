import playerJson from "../../../data/player.json";
import { type PlayerData, playerDataSchema } from "../../../data/schemas/player";

/** Parse untrusted player data; throws a descriptive error when invalid. */
export function parsePlayerData(raw: unknown): PlayerData {
  const result = playerDataSchema.safeParse(raw);
  if (!result.success) throw new Error(`invalid data/player.json: ${result.error.message}`);
  return result.data;
}

/** Loaded and validated at module load, so bad data fails loudly at startup. */
export const PLAYER_DATA: PlayerData = parsePlayerData(playerJson);
