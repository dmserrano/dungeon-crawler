import { beforeAll, describe, expect, it } from "vitest";
import { CHASER_DATA } from "../src/sim/data/enemies";
import { entitiesById } from "../src/sim/ecs/world";
import { NO_INPUT } from "../src/sim/input-frame";
import { buildNavGrid, cellOf, findPath, type NavGrid } from "../src/sim/pathfinding";
import { createRapierWorld, initPhysics } from "../src/sim/physics/rapier-world";
import type { Room, WallBox } from "../src/sim/room";
import { createSimState, entityViews, step } from "../src/sim/step";

const box = (x0: number, y0: number, x1: number, y1: number): WallBox => ({
  x: (x0 + x1) / 2,
  y: (y0 + y1) / 2,
  hw: (x1 - x0) / 2,
  hh: (y1 - y0) / 2,
});

const room = (walls: WallBox[], over: Partial<Room> = {}): Room => ({
  width: 320,
  height: 240,
  walls,
  playerStart: { x: 40, y: 40 },
  dummy: null,
  enemies: [],
  doors: [],
  ...over,
});

/** Free-cell picture: '#' wall, '.' free, for readable grids. */
function gridOf(rows: string[]): NavGrid {
  const cols = rows[0]?.length ?? 0;
  const blocked = new Uint8Array(cols * rows.length);
  rows.forEach((row, r) => {
    for (let c = 0; c < cols; c++) blocked[r * cols + c] = row[c] === "#" ? 1 : 0;
  });
  return { cols, rows: rows.length, cell: 16, blocked };
}
const at = (c: number, r: number) => ({ x: (c + 0.5) * 16, y: (r + 0.5) * 16 });

describe("nav grid", () => {
  it("rasterises wall boxes into blocked cells", () => {
    const g = buildNavGrid(room([box(32, 16, 64, 48)]));
    expect(g.cols).toBe(20);
    expect(g.rows).toBe(15);
    expect(g.blocked[cellOf(g, at(2, 1))]).toBe(1);
    expect(g.blocked[cellOf(g, at(3, 2))]).toBe(1);
    expect(g.blocked[cellOf(g, at(4, 1))]).toBe(0);
    expect(g.blocked[cellOf(g, at(1, 1))]).toBe(0);
    expect(cellOf(g, { x: -1, y: 0 })).toBe(-1);
  });
});

describe("findPath", () => {
  it("routes around a concave obstacle", () => {
    const g = gridOf([
      "..........",
      "..######..",
      "..#....#..",
      "..#.####..",
      "..#.......",
      "..........",
    ]);
    const path = findPath(g, at(4, 2), at(8, 2), 60);
    expect(path).not.toBeNull();
    for (const p of path ?? []) expect(g.blocked[cellOf(g, p)]).toBe(0);
    expect(path?.at(-1)).toEqual(at(8, 2));
    // Must leave the cup through the gap at column 3 and go around: a long way, not a short hop.
    expect(path?.length).toBeGreaterThan(5);
  });

  it("returns an empty path in the same cell and null for a blocked goal", () => {
    const g = gridOf(["..#", "..."]);
    expect(findPath(g, at(0, 0), at(0, 0), 10)).toEqual([]);
    expect(findPath(g, at(0, 0), at(2, 0), 10)).toBeNull();
  });

  it("returns null when the target is unreachable or beyond the length cap", () => {
    const sealed = gridOf(["..#..", "..#..", "..#.."]);
    expect(findPath(sealed, at(0, 1), at(4, 1), 50)).toBeNull();
    const open = gridOf(["..........."]);
    expect(findPath(open, at(0, 0), at(10, 0), 10)).toHaveLength(10);
    expect(findPath(open, at(0, 0), at(10, 0), 9)).toBeNull();
  });

  it("does not cut corners", () => {
    const g = gridOf([".#", "#."]);
    expect(findPath(g, at(0, 0), at(1, 1), 10)).toBeNull();
    const h = gridOf([".#.", "..."]);
    const path = findPath(h, at(0, 0), at(2, 0), 10);
    expect(path?.map((p) => cellOf(h, p))).toEqual([3, 4, 5, 2]);
  });

  it("breaks ties by cell index, identically on every call", () => {
    const g = gridOf(["...", "...", "..."]);
    const a = findPath(g, at(0, 0), at(2, 2), 10);
    expect(a).toEqual([at(1, 1), at(2, 2)]);
    for (let i = 0; i < 5; i++) expect(findPath(g, at(0, 0), at(2, 2), 10)).toEqual(a);
    // Two equal-cost routes around a pillar: the lower cell index (the upper route) wins.
    const p = gridOf(["...", ".#.", "..."]);
    expect(findPath(p, at(0, 1), at(2, 1), 10)?.map((c) => cellOf(p, c))).toEqual([0, 1, 2, 5]);
  });
});

describe("enemies path around a concave obstacle", () => {
  beforeAll(async () => {
    await initPhysics();
  });

  // A cup open to the left, with the chaser inside and the player behind its back wall: the direct
  // line is blocked and wall avoidance alone would push against the back wall forever.
  const cup = room([box(96, 64, 160, 80), box(96, 160, 160, 176), box(144, 64, 160, 176)], {
    playerStart: { x: 230, y: 120 },
    enemies: [{ type: "chaser", x: 120, y: 120 }],
  });

  it("reaches the player", () => {
    let s = createSimState(createRapierWorld(), 1, cup);
    let closest = Number.POSITIVE_INFINITY;
    for (let t = 0; t < 1200 && !s.player.dead; t++) {
      s = step(s, NO_INPUT);
      const c = entityViews(s).find((v) => v.ai !== null);
      if (c) closest = Math.min(closest, Math.hypot(c.x - s.player.x, c.y - s.player.y));
    }
    expect(closest).toBeLessThan(CHASER_DATA.attackRange);
  });

  it("falls back to wall avoidance when the player is sealed off", () => {
    const sealed = room([box(150, 0, 166, 240)], {
      playerStart: { x: 200, y: 120 },
      enemies: [{ type: "chaser", x: 120, y: 120 }],
    });
    let s = createSimState(createRapierWorld(), 1, sealed);
    for (let t = 0; t < 300; t++) s = step(s, NO_INPUT);
    const c = entityViews(s).find((v) => v.ai !== null);
    expect(c?.x).toBeLessThan(150); // stays on its side of the wall, no crash
    expect(c?.ai).toBe("chase");
    const mem = entitiesById(s.ecs).find((e) => e.ai)?.ai;
    expect(mem?.path).toEqual([]);
  });
});
