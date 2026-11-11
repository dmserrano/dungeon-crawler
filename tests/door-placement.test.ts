import { describe, expect, it } from "vitest";
import { doorPlacement } from "../src/render/doors";

const room = { width: 320, height: 224 };

describe("doorPlacement", () => {
  it("puts a north door in the wall row above the room, arch up", () => {
    expect(doorPlacement(room, { x: 160, y: 0 })).toEqual({ x: 160, y: -8, rotation: 0 });
  });

  it("puts a south door in the wall row below the room, rotated 180 degrees", () => {
    expect(doorPlacement(room, { x: 160, y: 224 })).toEqual({ x: 160, y: 232, rotation: Math.PI });
  });

  it("puts a west door in the wall column left of the room, arch facing west", () => {
    expect(doorPlacement(room, { x: 0, y: 112 })).toEqual({
      x: -8,
      y: 112,
      rotation: -Math.PI / 2,
    });
  });

  it("puts an east door in the wall column right of the room, arch facing east", () => {
    expect(doorPlacement(room, { x: 320, y: 112 })).toEqual({
      x: 328,
      y: 112,
      rotation: Math.PI / 2,
    });
  });
});
