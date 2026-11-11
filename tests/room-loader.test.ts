import { describe, expect, it } from "vitest";
import { loadRoomFile, roomFiles } from "../src/cli/rooms";
import { parseRoom } from "../src/sim/data/room";
import { ARENA, CHASER_STARTS, DUMMY_START, RANGED_START } from "./arena";

/** Minimal valid map: 5x4 tiles of 10 px, margin 1 => 30x20 room. */
function map(over: Record<string, unknown> = {}, objects: unknown[] = []) {
  const data = [1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 1];
  return {
    type: "map",
    width: 5,
    height: 4,
    tilewidth: 10,
    tileheight: 10,
    properties: [{ name: "margin", type: "int", value: 1 }],
    layers: [
      { type: "tilelayer", name: "walls", width: 5, height: 4, data },
      {
        type: "objectgroup",
        name: "objects",
        objects: [{ name: "s", class: "player_start", x: 20, y: 20 }, ...objects],
      },
    ],
    ...over,
  };
}

describe("every data/rooms/*.tmj", () => {
  for (const file of roomFiles()) {
    it(`${file.split("/").pop()} is valid`, () => {
      expect(() => loadRoomFile(file)).not.toThrow();
    });
  }
});

describe("test-arena", () => {
  it("reproduces the former hard-coded room", () => {
    expect(ARENA.width).toBe(320);
    expect(ARENA.height).toBe(224);
    expect(ARENA.playerStart).toEqual({ x: 160, y: 112 });
    expect(DUMMY_START).toEqual({ x: 240, y: 64 });
    expect(CHASER_STARTS.map((c) => [c.x, c.y])).toEqual([
      [40, 48],
      [40, 176],
    ]);
    expect(RANGED_START).toEqual({ x: 290, y: 190, type: "ranged" });
    expect(ARENA.walls).toEqual([
      { x: 160, y: -8, hw: 176, hh: 8 },
      // Greedy row-major: the side columns run down through the corner tiles.
      { x: -8, y: 120, hw: 8, hh: 120 },
      { x: 328, y: 120, hw: 8, hh: 120 },
      { x: 160, y: 232, hw: 160, hh: 8 },
    ]);
  });
});

describe("parseRoom", () => {
  it("merges walls greedily in row-major order", () => {
    const room = parseRoom(map());
    expect(room.width).toBe(30);
    expect(room.height).toBe(20);
    expect(room.walls).toEqual([
      { x: 15, y: -5, hw: 25, hh: 5 },
      { x: -5, y: 15, hw: 5, hh: 15 },
      { x: 35, y: 15, hw: 5, hh: 15 },
      { x: 15, y: 25, hw: 15, hh: 5 },
    ]);
  });

  it("parses doors, enemies and the dummy", () => {
    const room = parseRoom(
      map({}, [
        { name: "d", class: "dummy", x: 30, y: 30 },
        { name: "e", type: "enemy", x: 25, y: 25, properties: [{ name: "type", value: "chaser" }] },
        {
          name: "north",
          class: "door",
          x: 20,
          y: 10,
          properties: [
            { name: "to", value: "other" },
            { name: "toDoor", value: "south" },
          ],
        },
      ]),
    );
    expect(room.dummy).toEqual({ x: 20, y: 20 });
    expect(room.enemies).toEqual([{ type: "chaser", x: 15, y: 15 }]);
    expect(room.doors).toEqual([{ name: "north", to: "other", toDoor: "south", x: 10, y: 0 }]);
  });

  const bad = (label: string, raw: unknown, re: RegExp) =>
    it(`rejects ${label}`, () => expect(() => parseRoom(raw, "t")).toThrow(re));

  bad("non-maps", { nope: 1 }, /invalid room t/);
  bad(
    "unknown enemy types",
    map({}, [
      { name: "e", class: "enemy", x: 20, y: 20, properties: [{ name: "type", value: "dragon" }] },
    ]),
    /unknown enemy type "dragon"/,
  );
  bad(
    "enemies without a type",
    map({}, [{ name: "e", class: "enemy", x: 20, y: 20 }]),
    /missing string property/,
  );
  bad(
    "unknown object kinds",
    map({}, [{ name: "x", class: "chest", x: 20, y: 20 }]),
    /unknown object kind/,
  );
  bad(
    "a second player_start",
    map({}, [{ name: "s2", class: "player_start", x: 20, y: 20 }]),
    /more than one player_start/,
  );
  bad(
    "a second dummy",
    map({}, [
      { name: "a", class: "dummy", x: 20, y: 20 },
      { name: "b", class: "dummy", x: 20, y: 20 },
    ]),
    /more than one dummy/,
  );
  bad(
    "objects outside the room",
    map({}, [{ name: "d", class: "dummy", x: 400, y: 20 }]),
    /outside the room/,
  );
  bad(
    "a door without target",
    map({}, [{ name: "d", class: "door", x: 20, y: 20 }]),
    /missing string property/,
  );
  bad(
    "duplicate door names",
    map(
      {},
      [1, 2].map(() => ({
        name: "d",
        class: "door",
        x: 20,
        y: 20,
        properties: [
          { name: "to", value: "a" },
          { name: "toDoor", value: "b" },
        ],
      })),
    ),
    /duplicate door/,
  );
  bad("a missing player_start", map({ layers: map().layers.slice(0, 1) }), /missing player_start/);
  bad("a missing walls layer", map({ layers: map().layers.slice(1) }), /exactly one tile layer/);
  bad("a bad margin", map({ properties: [{ name: "margin", value: -1 }] }), /margin/);
  bad(
    "a margin larger than the map",
    map({ properties: [{ name: "margin", value: 3 }] }),
    /margin exceeds/,
  );
  bad(
    "mismatched layer data",
    map({ layers: [{ type: "tilelayer", name: "walls", width: 5, height: 4, data: [1] }] }),
    /data length/,
  );
  bad(
    "a walls layer of the wrong size",
    map({ layers: [{ type: "tilelayer", name: "walls", width: 1, height: 1, data: [1] }] }),
    /differs from the map/,
  );
});
