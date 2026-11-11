import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRoomByName } from "../src/cli/rooms";
import { parseFloor, validateFloor } from "../src/sim/data/floor";
import type { DoorSpawn, Room } from "../src/sim/room";

const FLOOR_PATH = join(import.meta.dirname, "../data/floors/mini.json");

function room(doors: DoorSpawn[]): Room {
  return {
    width: 100,
    height: 100,
    walls: [],
    playerStart: { x: 50, y: 50 },
    dummy: null,
    enemies: [],
    doors,
  };
}
const door = (name: string, to: string, toDoor: string): DoorSpawn => ({
  name,
  to,
  toDoor,
  x: 0,
  y: 0,
});

function rooms(entries: Record<string, Room>): Map<string, Room> {
  return new Map(Object.entries(entries));
}

describe("data/floors/mini.json", () => {
  const floor = parseFloor(JSON.parse(readFileSync(FLOOR_PATH, "utf8")), "mini");

  it("names a start hub and four rooms", () => {
    expect(floor.start).toBe("hub");
    expect(floor.rooms).toEqual(["hub", "chasers", "ranged", "mixed"]);
  });

  it("passes the validator with the real rooms", () => {
    const loaded = new Map(floor.rooms.map((id) => [id, loadRoomByName(id)]));
    expect(validateFloor(floor, loaded)).toEqual([]);
  });

  it("has a doorless-enemy hub with three doors and three dead-end combat rooms", () => {
    const hub = loadRoomByName("hub");
    expect(hub.enemies).toHaveLength(0);
    expect(hub.doors).toHaveLength(3);
    for (const id of ["chasers", "ranged", "mixed"]) {
      const r = loadRoomByName(id);
      expect(r.doors).toHaveLength(1);
      expect(r.doors[0]?.to).toBe("hub");
      expect(r.enemies.length).toBeGreaterThan(0);
    }
    const types = (id: string) => new Set(loadRoomByName(id).enemies.map((e) => e.type));
    expect([...types("chasers")]).toEqual(["chaser"]);
    expect([...types("ranged")]).toEqual(["ranged"]);
    expect(types("mixed")).toEqual(new Set(["chaser", "ranged"]));
  });
});

describe("parseFloor", () => {
  it("rejects a malformed floor", () => {
    expect(() => parseFloor({ start: "a" })).toThrow(/invalid floor/);
    expect(() => parseFloor({ start: "a", rooms: [] })).toThrow(/invalid floor/);
  });
});

describe("validateFloor failing fixtures", () => {
  const good = () => rooms({ a: room([door("d", "b", "d")]), b: room([door("d", "a", "d")]) });
  const floor = { start: "a", rooms: ["a", "b"] };

  it("accepts a valid pair", () => {
    expect(validateFloor(floor, good())).toEqual([]);
  });

  it("flags a room that does not load", () => {
    const r = good();
    r.delete("b");
    expect(validateFloor(floor, r).join("\n")).toMatch(/room "b" does not load/);
  });

  it("flags a missing start room", () => {
    expect(validateFloor({ start: "z", rooms: ["a", "b"] }, good()).join("\n")).toMatch(
      /start room "z"/,
    );
  });

  it("flags a door whose target room does not exist", () => {
    const r = rooms({ a: room([door("d", "nope", "d")]) });
    expect(validateFloor({ start: "a", rooms: ["a"] }, r).join("\n")).toMatch(
      /target room "nope" does not exist/,
    );
  });

  it("flags a door whose toDoor does not exist", () => {
    const r = rooms({ a: room([door("d", "b", "x")]), b: room([door("d", "a", "d")]) });
    expect(validateFloor(floor, r).join("\n")).toMatch(/door "x" does not exist in "b"/);
  });

  it("flags an asymmetric link", () => {
    const r = rooms({
      a: room([door("d", "b", "d")]),
      b: room([door("d", "b", "d")]),
    });
    expect(validateFloor(floor, r).join("\n")).toMatch(/not symmetric/);
  });

  it("flags a room not connected to the start", () => {
    const r = rooms({ a: room([]), b: room([]) });
    expect(validateFloor(floor, r).join("\n")).toMatch(/room "b" is not connected to the start/);
  });

  it("flags duplicate room ids", () => {
    expect(
      validateFloor({ start: "a", rooms: ["a", "a"] }, rooms({ a: room([]) })).join("\n"),
    ).toMatch(/duplicate room "a"/);
  });
});
