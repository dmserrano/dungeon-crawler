/// <reference types="vite/client" />
import { Assets, Rectangle, Texture } from "pixi.js";
import manifestJson from "../../assets/manifest.json";
import { type Manifest, manifestSchema, tileRect } from "./manifest";

/** Bundled asset URLs keyed by path relative to `assets/`. */
const urls = import.meta.glob<string>("../../assets/*/Tilemap/tilemap.png", {
  eager: true,
  query: "?url",
  import: "default",
});

export interface Art {
  manifest: Manifest;
  /** Texture for a 0-based tile index of the manifest's tileset. */
  tile(index: number): Texture;
}

/** Load the tileset named in `assets/manifest.json` and slice it into tile textures. */
export async function loadArt(): Promise<Art> {
  const manifest = manifestSchema.parse(manifestJson);
  const url = urls[`../../assets/${manifest.tileset.image}`];
  if (url === undefined) throw new Error(`asset "${manifest.tileset.image}" is not bundled`);
  const base = await Assets.load<Texture>(url);
  base.source.scaleMode = "nearest";
  const cache = new Map<number, Texture>();
  return {
    manifest,
    tile(index) {
      let t = cache.get(index);
      if (!t) {
        const r = tileRect(manifest.tileset, index);
        t = new Texture({ source: base.source, frame: new Rectangle(r.x, r.y, r.w, r.h) });
        cache.set(index, t);
      }
      return t;
    },
  };
}
