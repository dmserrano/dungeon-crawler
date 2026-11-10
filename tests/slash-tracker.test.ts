import { describe, expect, it } from "vitest";
import { createSlashTracker } from "../src/render/slash-tracker";
import type { AttackPhase } from "../src/sim/combat";
import { PLAYER_DATA } from "../src/sim/data/player";

const A = PLAYER_DATA.attack;
const snap = (attack: AttackPhase | null, frozen = 0) => ({ attack, frozen });

describe("slash tracker (render-only swing progress)", () => {
  it("has no view when idle", () => {
    const t = createSlashTracker();
    expect(t.view(0.5, false)).toBeNull();
    t.onTick(40, snap(null), snap(null));
    expect(t.view(0.5, false)).toBeNull();
  });

  it("captures the aim from the frame that starts the swing", () => {
    const t = createSlashTracker();
    t.onTick(64, snap(null), snap("windup"));
    t.onTick(200, snap("windup"), snap("windup")); // later aim changes are ignored
    expect(t.view(0, false)?.aim).toBe(64);
  });

  it("walks windup, active and recovery with progress in 0..1", () => {
    const t = createSlashTracker();
    const phases: (AttackPhase | undefined)[] = [];
    t.onTick(0, snap(null), snap("windup"));
    let prev: AttackPhase = "windup";
    phases.push(t.view(0, false)?.phase);
    const total = A.windupTicks + A.activeTicks + A.recoveryTicks;
    for (let i = 1; i < total; i++) {
      const sim =
        i < A.windupTicks ? "windup" : i < A.windupTicks + A.activeTicks ? "active" : "recovery";
      t.onTick(0, snap(prev), snap(sim));
      prev = sim;
      const v = t.view(0.5, false);
      phases.push(v?.phase);
      expect(v?.progress).toBeGreaterThanOrEqual(0);
      expect(v?.progress).toBeLessThanOrEqual(1);
    }
    expect(phases).toContain("windup");
    expect(phases).toContain("active");
    expect(phases).toContain("recovery");
    t.onTick(0, snap("recovery"), snap(null));
    expect(t.view(0, false)).toBeNull();
  });

  it("holds progress during hitstop", () => {
    const t = createSlashTracker();
    t.onTick(0, snap(null), snap("windup"));
    t.onTick(0, snap("windup"), snap("windup"));
    const before = t.view(0, false)?.progress;
    t.onTick(0, snap("windup"), snap("windup", 3)); // frozen: sim did not advance the swing
    t.onTick(0, snap("windup", 3), snap("windup", 2));
    expect(t.view(0, true)?.progress).toBe(before);
  });
});
