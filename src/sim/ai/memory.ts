/**
 * Behavior states of every enemy. Chaser: idle, chase, telegraph, attack, stagger, dead. Ranged:
 * idle, kite, telegraph, fire, stagger, dead. `dead` is terminal (dead enemies are removed within
 * the tick).
 */
export type AiState =
  | "idle"
  | "chase"
  | "kite"
  | "telegraph"
  | "attack"
  | "fire"
  | "stagger"
  | "dead";

/** Everything the state machine remembers between ticks. */
export interface AiMemory {
  state: AiState;
  /** Ticks spent in the current state. */
  t: number;
  /** Ticks until the next telegraph is allowed. */
  cooldown: number;
  /** Lunge direction (unit), locked when the telegraph starts. */
  dir: { x: number; y: number };
  /** True once this lunge has connected (or been spent), so it damages at most once. */
  spent: boolean;
  /** Cached A* waypoints (cell centres) toward the player; empty when none (ADR 0008). */
  path: { x: number; y: number }[];
  /** Ticks until the path is recomputed; staggered per enemy at spawn. */
  pathT: number;
}

/** What the enemy perceives this tick. */
export interface AiSense {
  /** Centre distance to the player (Infinity when there is no live player). */
  dist: number;
  /** Unit vector toward the player (zero when on top of them). */
  toPlayer: { x: number; y: number };
  /** Just hit: knockback pending or recovering from it. */
  staggered: boolean;
  dead: boolean;
}

export function newAiMemory(): AiMemory {
  return {
    state: "idle",
    t: 0,
    cooldown: 0,
    dir: { x: 0, y: 0 },
    spent: false,
    path: [],
    pathT: 0,
  };
}

export const enter = (m: AiMemory, state: AiState, patch: Partial<AiMemory> = {}): AiMemory => ({
  ...m,
  state,
  t: 0,
  spent: false,
  ...patch,
});
