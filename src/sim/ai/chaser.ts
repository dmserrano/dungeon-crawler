import type { ChaserData } from "../../../data/schemas/enemies";
import { type AiMemory, type AiSense, enter } from "./memory";

/**
 * The chaser state machine as a pure function: no RNG, no world access. A hit interrupts any
 * state into stagger (a telegraph or lunge in progress is cancelled); stagger ends into chase
 * with a cooldown. Telegraph and lunge lengths come from `data`.
 */
export function nextAiState(m: AiMemory, s: AiSense, data: ChaserData): AiMemory {
  if (m.state === "dead") return m;
  if (s.dead) return enter(m, "dead");
  if (s.staggered) {
    return m.state === "stagger"
      ? { ...m, t: m.t + 1 }
      : enter(m, "stagger", { cooldown: data.cooldownTicks });
  }
  const cooldown = Math.max(0, m.cooldown - 1);
  switch (m.state) {
    case "idle":
      return s.dist <= data.aggroRange ? enter(m, "chase", { cooldown }) : { ...m, cooldown };
    case "stagger":
      return enter(m, "chase", { cooldown });
    case "chase":
      if (s.dist <= data.attackRange && m.cooldown === 0) {
        return enter(m, "telegraph", { dir: s.toPlayer });
      }
      return { ...m, t: m.t + 1, cooldown };
    case "telegraph":
      return m.t + 1 >= data.telegraphTicks ? enter(m, "attack") : { ...m, t: m.t + 1 };
    case "attack":
      return m.t + 1 >= data.lunge.ticks
        ? enter(m, "chase", { cooldown: data.cooldownTicks })
        : { ...m, t: m.t + 1 };
    case "kite":
    case "fire":
      return m; // ranged-only states; see ranged.ts
  }
}
