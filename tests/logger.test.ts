import { describe, expect, it } from "vitest";
import { createLogger } from "../src/debug/logger";

describe("createLogger", () => {
  it("records entries in order with the injected clock", () => {
    let t = 0;
    const log = createLogger({ capacity: 10, now: () => ++t });
    log.info("boot");
    log.warn("careful", { x: 1 });
    expect(log.entries().map((e) => [e.t, e.level, e.msg])).toEqual([
      [1, "info", "boot"],
      [2, "warn", "careful"],
    ]);
    expect(log.entries()[1]?.data).toEqual({ x: 1 });
  });

  it("drops the oldest entries past capacity", () => {
    const log = createLogger({ capacity: 3, now: () => 0 });
    for (let i = 0; i < 5; i++) log.info(`m${i}`);
    expect(log.entries().map((e) => e.msg)).toEqual(["m2", "m3", "m4"]);
  });

  it("filters below the minimum level", () => {
    const log = createLogger({ capacity: 5, now: () => 0, minLevel: "warn" });
    log.debug("a");
    log.info("b");
    log.warn("c");
    log.error("d");
    expect(log.entries().map((e) => e.msg)).toEqual(["c", "d"]);
  });

  it("dumps plain text, one line per entry", () => {
    const log = createLogger({ capacity: 5, now: () => 5 });
    log.error("boom", { code: 2 });
    expect(log.dump()).toBe('[5] ERROR boom {"code":2}');
  });

  it("rejects a non-positive capacity", () => {
    expect(() => createLogger({ capacity: 0 })).toThrow();
  });
});
