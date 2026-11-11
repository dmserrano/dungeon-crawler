import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { loadFloorByName, loadRoomByName } from "../src/cli/rooms";
import { createRapierWorld, initPhysics } from "../src/sim/physics/rapier-world";
import { decodeInputs, parseReplay, runReplay } from "../src/sim/replay";
import { createSimState, entityViews, hashSimState, step } from "../src/sim/step";

// Acceptance replay for the mini-dungeon: the bot clears chasers, ranged and mixed, going back
// through the hub each time. Re-record with scripts/record-mini-replay.ts when gameplay changes.
const replay = parseReplay(
  JSON.parse(readFileSync(new URL("./fixtures/replay.mini-dungeon.json", import.meta.url), "utf8")),
);
const FINAL_HASH = "389f1aa9";

describe("mini-dungeon acceptance replay", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  it("verifies headless and ends alive in the hub with every room cleared", () => {
    expect(replay.floor).toBe("mini");
    expect(replay.finalHash).toBe(FINAL_HASH);
    const floor = loadFloorByName("mini");
    const final = runReplay(replay, createRapierWorld(), floor, loadRoomByName);
    expect(hashSimState(final)).toBe(FINAL_HASH);
    expect(final.roomId).toBe("hub");
    expect(final.player.dead).toBe(false);
    // The hub has no enemies, so it counts as cleared the moment the run starts.
    expect(final.clearedRooms).toEqual(["chasers", "hub", "mixed", "ranged"]);
    expect(final.locked).toBe(false);
  });

  it("visits hub, spoke, hub three times, locking and unlocking each fight and carrying HP", () => {
    const floor = loadFloorByName("mini");
    let s = createSimState(createRapierWorld(), replay.seed, loadRoomByName(floor.start), {
      roomId: floor.start,
      rooms: loadRoomByName,
    });
    const path: string[] = [s.roomId];
    const hpAtDoor: number[] = [];
    const lockedAfterEntry: Record<string, boolean> = {};
    let unlocks = 0;
    let wasLocked = s.locked;
    expect(wasLocked).toBe(false); // the hub starts open
    for (const f of decodeInputs(replay.inputs)) {
      const prev = s;
      s = step(s, f);
      if (!prev.transition && s.transition) hpAtDoor.push(s.player.hp);
      if (prev.transition && !s.transition) {
        // Transition just ended: HP is what it was at the door, enemies are live in a fresh spoke.
        expect(s.player.hp).toBe(hpAtDoor[hpAtDoor.length - 1]);
        lockedAfterEntry[s.roomId] = s.locked;
        if (s.locked) expect(entityViews(s).some((v) => !v.projectile)).toBe(true);
      }
      if (s.roomId !== path[path.length - 1]) path.push(s.roomId);
      if (wasLocked && !s.locked) unlocks++;
      wasLocked = s.locked;
    }
    expect(path).toHaveLength(7);
    expect(path[0]).toBe("hub");
    expect(path.filter((r) => r === "hub")).toHaveLength(4);
    expect([...path.filter((r) => r !== "hub")].sort()).toEqual(["chasers", "mixed", "ranged"]);
    // Each spoke locked on entry and unlocked once; the hub never locked.
    expect(lockedAfterEntry).toEqual({ chasers: true, ranged: true, mixed: true, hub: false });
    expect(unlocks).toBe(3);
    expect(s.player.hp).toBeGreaterThan(0);
    expect(s.player.hp).toBeLessThan(6);
  });
});
