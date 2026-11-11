import { z } from "zod";

/** `assets/manifest.json`: every asset the game ships, plus which tile each sprite uses. */
export const manifestSchema = z.object({
  tileset: z.object({
    /** Path under `assets/`. */
    image: z.string(),
    tileWidth: z.number().int().positive(),
    tileHeight: z.number().int().positive(),
    spacing: z.number().int().nonnegative(),
    columns: z.number().int().positive(),
  }),
  /** Tile index (0-based, in the tileset) per sprite. */
  sprites: z.object({
    player: z.number().int().nonnegative(),
    chaser: z.number().int().nonnegative(),
    ranged: z.number().int().nonnegative(),
    dummy: z.number().int().nonnegative(),
    projectile: z.number().int().nonnegative(),
  }),
  /** Every file under `assets/` (paths relative to `assets/`). */
  files: z.array(z.string()),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type Tileset = Manifest["tileset"];

/** Pixel rectangle of a tile (0-based index) inside the tileset image. */
export function tileRect(
  ts: Tileset,
  index: number,
): { x: number; y: number; w: number; h: number } {
  const col = index % ts.columns;
  const row = Math.floor(index / ts.columns);
  return {
    x: col * (ts.tileWidth + ts.spacing),
    y: row * (ts.tileHeight + ts.spacing),
    w: ts.tileWidth,
    h: ts.tileHeight,
  };
}
