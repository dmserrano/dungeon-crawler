import { loadFloorByName, loadRoomByName } from "../src/cli/rooms";

/** The test arena, loaded from data/rooms/test-arena.tmj, plus the values tests assert against. */
export const ARENA = loadRoomByName("test-arena");
/** The floor whose only room is the arena (data/floors/test-arena.json). */
export const ARENA_FLOOR = loadFloorByName("test-arena");
export const ARENA_ROOMS = loadRoomByName;
export const ROOM_WIDTH = ARENA.width;
export const ROOM_HEIGHT = ARENA.height;
export const PLAYER_START = ARENA.playerStart;
export const CHASER_STARTS = ARENA.enemies.filter((e) => e.type === "chaser");

function required<T>(v: T | null | undefined, what: string): T {
  if (v === null || v === undefined) throw new Error(`test-arena has no ${what}`);
  return v;
}

export const DUMMY_START = required(ARENA.dummy, "dummy");
export const RANGED_START = required(
  ARENA.enemies.find((e) => e.type === "ranged"),
  "ranged enemy",
);
