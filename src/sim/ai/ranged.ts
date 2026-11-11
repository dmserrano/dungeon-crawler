import type { RangedData } from "../../../data/schemas/enemies";
import { type AiMemory, type AiSense, enter } from "./memory";

/**
 * The ranged enemy's state machine as a pure function (same memory and senses as the chaser).
 * idle -> kite (keep distance) -> telegraph (aim locked) -> fire (one tick, spawns the shot) ->
 * kite with a cooldown. A hit interrupts into stagger, which ends back into kite.
 */
export function nextRangedState(m: AiMemory, s: AiSense, data: RangedData): AiMemory {
  if (m.state === "dead") return m;
  if (s.dead) return enter(m, "dead");
  if (s.staggered) {
    return m.state === "stagger"
      ? { ...m, t: m.t + 1 }
      : enter(m, "stagger", { cooldown: data.fireIntervalTicks });
  }
  const cooldown = Math.max(0, m.cooldown - 1);
  switch (m.state) {
    case "idle":
      return s.dist <= data.aggroRange ? enter(m, "kite", { cooldown }) : { ...m, cooldown };
    case "stagger":
      return enter(m, "kite", { cooldown });
    case "kite":
      if (s.dist <= data.aggroRange && m.cooldown === 0) {
        return enter(m, "telegraph", { dir: s.toPlayer });
      }
      return { ...m, t: m.t + 1, cooldown };
    case "telegraph":
      return m.t + 1 >= data.telegraphTicks ? enter(m, "fire") : { ...m, t: m.t + 1 };
    case "fire":
      return enter(m, "kite", { cooldown: data.fireIntervalTicks });
    default:
      return m; // chaser-only states
  }
}
