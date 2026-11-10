import type { AttackPhase } from "../sim/combat";
import { PLAYER_DATA } from "../sim/data/player";
import type { PlayerSnapshot } from "../sim/step";

/**
 * Render-only tracking of the player's swing, so the slash effect can point along the swing's
 * aim and animate within each phase. Nothing here feeds back into the sim or its hash: it only
 * observes the snapshots and input frames the loop already has. It is an approximation (it
 * counts ticks per phase and pauses during hitstop); the sim stays the source of truth.
 */
export interface SlashView {
  /** Aim step (0-255) captured when the swing started. */
  aim: number;
  phase: AttackPhase;
  /** 0..1 through the current phase. */
  progress: number;
}

type Observed = Pick<PlayerSnapshot, "attack" | "frozen">;

const A = PLAYER_DATA.attack;
const PHASE_TICKS: Record<AttackPhase, number> = {
  windup: A.windupTicks,
  active: A.activeTicks,
  recovery: A.recoveryTicks,
};

export interface SlashTracker {
  /** Call once per sim tick with the frame that was stepped and the snapshots around the step. */
  onTick(aim: number, before: Observed, after: Observed): void;
  /** Current effect state, or null when no swing is in progress. `alpha` is the render blend. */
  view(alpha: number, frozen: boolean): SlashView | null;
}

export function createSlashTracker(): SlashTracker {
  let aim = 0;
  let phase: AttackPhase | null = null;
  let ticks = 0; // sim ticks spent in the current phase

  return {
    onTick(frameAim, before, after) {
      if (after.attack === null) {
        phase = null;
        ticks = 0;
        return;
      }
      if (before.attack === null) {
        aim = frameAim;
        phase = after.attack;
        ticks = 1; // the starting tick already advanced the swing once
        return;
      }
      if (after.attack !== phase) {
        phase = after.attack;
        ticks = 0;
        return;
      }
      if (before.frozen === 0 && after.frozen === 0) ticks++; // hitstop pauses the swing
    },
    view(alpha, frozen) {
      if (phase === null) return null;
      const len = PHASE_TICKS[phase];
      const raw = (ticks + (frozen ? 0 : alpha)) / len;
      return { aim, phase, progress: Math.min(1, Math.max(0, raw)) };
    },
  };
}
