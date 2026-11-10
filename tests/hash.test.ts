import { describe, expect, it } from "vitest";
import { hashState } from "../src/sim/state/hash";

describe("hashState", () => {
  it("ignores key order", () => {
    expect(hashState({ a: 1, b: [1, 2] })).toBe(hashState({ b: [1, 2], a: 1 }));
  });

  it("changes when state changes", () => {
    expect(hashState({ a: 1 })).not.toBe(hashState({ a: 2 }));
  });
});
