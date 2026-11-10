import { describe, expect, it } from "vitest";
import playerJson from "../data/player.json";
import { PLAYER_DATA, parsePlayerData } from "../src/sim/data/player";

describe("player data", () => {
  it("accepts the shipped file", () => {
    expect(parsePlayerData(playerJson)).toEqual(PLAYER_DATA);
    expect(PLAYER_DATA.radius).toBe(6);
  });

  it.each([
    ["not an object", 5],
    ["missing field", { radius: 6, maxSpeed: 90, acceleration: 1200 }],
    ["wrong type", { ...playerJson, maxSpeed: "fast" }],
    ["non-positive radius", { ...playerJson, radius: 0 }],
    ["damping above 1", { ...playerJson, damping: 1.5 }],
    ["unknown key", { ...playerJson, extra: 1 }],
    ["missing dash", { ...playerJson, dash: undefined }],
    ["fractional dash ticks", { ...playerJson, dash: { ...playerJson.dash, ticks: 7.5 } }],
    ["iframes longer than dash", { ...playerJson, dash: { ...playerJson.dash, iframeTicks: 9 } }],
  ])("rejects %s", (_name, raw) => {
    expect(() => parsePlayerData(raw)).toThrow(/invalid data\/player\.json/);
  });
});
