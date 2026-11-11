import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadFloorByName, loadRoomByName } from "../src/cli/rooms";
import { type Floor, parseFloor, type RoomSource, validateFloor } from "../src/sim/floor";
import type { DoorSpawn, Room } from "../src/sim/room";

const door = (name: string, to: string, toDoor: string): DoorSpawn => ({
  name,
  to,
  toDoor,
  x: 0,
  y: 0,
});
const room = (doors: DoorSpawn[]): Room => ({
  width: 100,
  height: 100,
  walls: [],
  playerStart: { x: 50, y: 50 },
  dummy: null,
  enemies: [],
  doors,
});
const source =
  (rooms: Record<string, Room>): RoomSource =>
  (id) => {
    const r = rooms[id];
    if (!r) throw new Error(`unknown room ${id}`);
    return r;
  };
const floor = (rooms: string[], start = "a"): Floor => ({ id: "t", start, rooms });

const good = {
  a: room([door("e", "b", "w")]),
  b: room([door("w", "a", "e")]),
};

describe("validateFloor", () => {
  it("accepts a well-formed floor", () => {
    expect(validateFloor(floor(["a", "b"]), source(good))).toEqual([]);
  });

  it("rejects a room that fails to load", () => {
    const errors = validateFloor(floor(["a", "b", "missing"]), source(good));
    expect(errors.join("\n")).toMatch(/room "missing" does not load/);
  });

  it("rejects a start room that is not listed", () => {
    expect(validateFloor(floor(["b"]), source(good)).join("\n")).toMatch(/start room "a"/);
  });

  it("rejects duplicate room ids", () => {
    expect(validateFloor(floor(["a", "b", "a"]), source(good)).join("\n")).toMatch(/duplicate/);
  });

  it("rejects a door whose target room does not exist", () => {
    const rooms = { a: room([door("e", "nowhere", "w")]), b: good.b };
    expect(validateFloor(floor(["a", "b"]), source(rooms)).join("\n")).toMatch(
      /unknown room "nowhere"/,
    );
  });

  it("rejects a door whose toDoor does not exist", () => {
    const rooms = { a: room([door("e", "b", "ghost")]), b: good.b };
    expect(validateFloor(floor(["a", "b"]), source(rooms)).join("\n")).toMatch(
      /missing door "b.ghost"/,
    );
  });

  it("rejects links that are not symmetric", () => {
    const rooms = {
      a: room([door("e", "b", "w")]),
      b: room([door("w", "c", "x")]),
      c: room([door("x", "b", "w")]),
    };
    expect(validateFloor(floor(["a", "b", "c"]), source(rooms)).join("\n")).toMatch(
      /not symmetric/,
    );
  });

  it("rejects rooms that are not connected to the start", () => {
    const rooms = { ...good, island: room([]) };
    expect(validateFloor(floor(["a", "b", "island"]), source(rooms)).join("\n")).toMatch(
      /"island" is not connected/,
    );
  });
});

describe("parseFloor", () => {
  it("defaults the room list to the start room", () => {
    expect(parseFloor({ start: "x" }, "f").rooms).toEqual(["x"]);
  });
  it("reads an explicit room list", () => {
    expect(parseFloor({ start: "x", rooms: ["x", "y"] }, "f").rooms).toEqual(["x", "y"]);
  });
  it("rejects a malformed floor", () => {
    expect(() => parseFloor({ rooms: [] }, "f")).toThrow(/invalid floor f/);
  });
});

describe("floors in data/floors", () => {
  const ids = readdirSync(new URL("../data/floors", import.meta.url))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));

  it.each(ids)("%s validates", (id) => {
    expect(validateFloor(loadFloorByName(id), loadRoomByName)).toEqual([]);
  });

  it("the mini-dungeon is a hub with three combat spokes", () => {
    const mini = loadFloorByName("mini");
    expect(mini.start).toBe("hub");
    expect([...mini.rooms].sort()).toEqual(["chasers", "hub", "mixed", "ranged"]);
    const hub = loadRoomByName("hub");
    expect(hub.enemies).toHaveLength(0);
    expect(hub.dummy).toBeNull();
    expect(hub.doors).toHaveLength(3);
    const kinds = (id: string) => loadRoomByName(id).enemies.map((e) => e.type);
    for (const id of ["chasers", "ranged", "mixed"]) {
      expect(loadRoomByName(id).doors).toHaveLength(1);
    }
    expect(new Set(kinds("chasers"))).toEqual(new Set(["chaser"]));
    expect(new Set(kinds("ranged"))).toEqual(new Set(["ranged"]));
    expect(new Set(kinds("mixed"))).toEqual(new Set(["chaser", "ranged"]));
  });
});
