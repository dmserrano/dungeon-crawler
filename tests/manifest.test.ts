import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { manifestSchema, tileRect } from "../src/render/manifest";

const root = new URL("../assets/", import.meta.url);
const manifest = manifestSchema.parse(
  JSON.parse(readFileSync(new URL("manifest.json", root), "utf8")),
);

describe("assets/manifest.json", () => {
  it("lists only files that exist", () => {
    for (const f of [...manifest.files, manifest.tileset.image]) {
      expect(existsSync(new URL(f, root)), f).toBe(true);
    }
  });

  it("lists the tileset image", () => {
    expect(manifest.files).toContain(manifest.tileset.image);
  });

  it("is credited in CREDITS.md", () => {
    const credits = readFileSync(new URL("../CREDITS.md", import.meta.url), "utf8");
    expect(credits).toContain("Tilemap/tilemap.png");
    expect(credits).toContain("CC0");
  });

  it("room tileset points at the same image", () => {
    const tsx = readFileSync(new URL("../data/rooms/tiny-dungeon.tsx", import.meta.url), "utf8");
    expect(tsx).toContain(`../../assets/${manifest.tileset.image}`);
  });
});

describe("tileRect", () => {
  it("accounts for spacing", () => {
    expect(tileRect(manifest.tileset, 0)).toEqual({ x: 0, y: 0, w: 16, h: 16 });
    expect(tileRect(manifest.tileset, 13)).toEqual({ x: 17, y: 17, w: 16, h: 16 });
  });
});
