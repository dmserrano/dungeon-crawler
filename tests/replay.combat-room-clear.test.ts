import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { createRecorder } from "../src/debug/recorder";
import { describeCombat } from "../src/debug/stats";
import { createFixedLoop } from "../src/game/loop";
import { NO_INPUT } from "../src/sim/input-frame";
import { createRapierWorld, initPhysics } from "../src/sim/physics/rapier-world";
import { decodeInputs, parseReplay, type Replay, runReplay } from "../src/sim/replay";
import { createSimState, entityViews, hashSimState, step, TICK_DT } from "../src/sim/step";

// Acceptance replays for the whole combat loop. If gameplay changes break them, re-record with
// scripts/record-combat-replays.ts (and bump SIM_VERSION when behavior changed).
const load = (name: string): Replay =>
  parseReplay(JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8")));

describe("combat scenario replays", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it("clears the test room: both chasers, the shooter and the dummy die, the player lives", () => {
    const replay = load("replay.combat-room-clear.json");
    expect(replay.finalHash).toBe("f2fca15a");
    const final = runReplay(replay, createRapierWorld());
    expect(hashSimState(final)).toBe("f2fca15a");
    expect(final.cleared).toBe(true);
    expect(final.player.dead).toBe(false);
    expect(entityViews(final).filter((v) => !v.projectile)).toHaveLength(0);
    // The run stops on the clearing tick: the last kill's notice and "cleared" are both queued.
    expect(final.events.map((e) => e.kind)).toEqual(["death", "cleared"]);
  });

  it("emits 'room cleared' exactly once, on the tick the last enemy dies", () => {
    const replay = load("replay.combat-room-clear.json");
    let s = createSimState(createRapierWorld(), replay.seed);
    const frames = decodeInputs(replay.inputs);
    const clearedAt: number[] = [];
    for (const f of frames) {
      s = step(s, f);
      if (s.events.some((e) => e.kind === "cleared")) clearedAt.push(s.tick);
    }
    expect(clearedAt).toEqual([frames.length]);
    // Idle ticks afterwards: the flag stays, the notice is not emitted again.
    for (let i = 0; i < 3; i++) s = step(s, NO_INPUT);
    expect(s.cleared).toBe(true);
    expect(s.events.some((e) => e.kind === "cleared")).toBe(false);
  });

  it("ends in player death, which stops the sim and never reports a clear", () => {
    const replay = load("replay.combat-player-death.json");
    expect(replay.finalHash).toBe("86701bff");
    const final = runReplay(replay, createRapierWorld());
    expect(hashSimState(final)).toBe("86701bff");
    expect(final.player.dead).toBe(true);
    expect(final.player.hp).toBe(0);
    expect(final.cleared).toBe(false);
    expect(step(final, NO_INPUT)).toBe(final); // no restart, the sim stays stopped
  });
});

describe("pause and single-step", () => {
  const setup = () => {
    const recorder = createRecorder();
    let ticks = 0;
    const loop = createFixedLoop(() => {
      ticks++;
      recorder.record(NO_INPUT);
    });
    return { loop, recorder, ticks: () => ticks };
  };
  const ms = TICK_DT * 1000;

  it("runs no ticks and records no frames while paused", () => {
    const { loop, recorder, ticks } = setup();
    loop.frame(0);
    loop.frame(ms * 3.5);
    expect(ticks()).toBe(3);
    loop.setPaused(true);
    loop.frame(ms * 10);
    loop.frame(ms * 20);
    expect(ticks()).toBe(3);
    expect(recorder.length).toBe(3);
  });

  it("steps exactly one tick per request while paused, and not at all while running", () => {
    const { loop, recorder, ticks } = setup();
    expect(loop.stepOnce()).toBe(false);
    expect(ticks()).toBe(0);
    loop.setPaused(true);
    expect(loop.stepOnce()).toBe(true);
    expect(loop.stepOnce()).toBe(true);
    loop.frame(0);
    loop.frame(ms * 5);
    expect(ticks()).toBe(2);
    expect(recorder.length).toBe(2);
  });

  it("resumes without replaying the paused time", () => {
    const { loop, ticks } = setup();
    loop.frame(0);
    loop.setPaused(true);
    loop.frame(5000);
    loop.setPaused(false);
    loop.frame(5000 + ms);
    expect(ticks()).toBe(1);
  });

  it("a paused-and-stepped session exports a replay that verifies", () => {
    const recorder = createRecorder();
    let s = createSimState(createRapierWorld(), 5);
    const loop = createFixedLoop(() => {
      recorder.record(NO_INPUT);
      s = step(s, NO_INPUT);
    });
    loop.frame(0);
    loop.frame(ms * 4);
    loop.setPaused(true);
    loop.frame(ms * 400);
    loop.stepOnce();
    loop.stepOnce();
    const replay = recorder.build(s);
    expect(replay.ticks).toBe(6);
    expect(
      hashSimState(runReplay(parseReplay(JSON.parse(JSON.stringify(replay))), createRapierWorld())),
    ).toBe(replay.finalHash);
  });
});

describe("combat overlay text", () => {
  const base = { hp: 4, maxHp: 6, attack: "active", dead: false, cleared: false, paused: false };

  it("shows HP and attack phase", () => {
    expect(describeCombat(base)).toBe("HP 4/6  attack active");
    expect(describeCombat({ ...base, attack: null })).toBe("HP 4/6  attack -");
  });

  it("flags pause, room cleared and death", () => {
    expect(describeCombat({ ...base, paused: true })).toContain("PAUSED");
    expect(describeCombat({ ...base, cleared: true })).toContain("ROOM CLEARED");
    expect(describeCombat({ ...base, dead: true, hp: 0 })).toContain("DEAD");
  });
});
