import {
  type RoomMap,
  type RoomMapObject,
  type RoomMapProperty,
  roomMapSchema,
} from "../../../data/schemas/room";
import type { DoorSpawn, EnemySpawn, Point, Room, WallBox } from "../room";
import { ENEMY_TYPES } from "./enemies";

const WALLS_LAYER = "walls";

function prop(
  props: readonly RoomMapProperty[],
  name: string,
): string | number | boolean | undefined {
  return props.find((p) => p.name === name)?.value;
}

function strProp(o: RoomMapObject, name: string): string {
  const v = prop(o.properties, name);
  if (typeof v !== "string" || v === "") {
    throw new Error(`object "${o.name}" is missing string property "${name}"`);
  }
  return v;
}

/**
 * Greedy merge of wall tiles into rectangles, scanning row-major: each unvisited wall tile starts
 * a rectangle that grows right as far as possible, then down while whole rows still fit.
 * Coordinates are shifted by (-offX, -offY) into room space.
 */
function mergeWalls(
  data: readonly number[],
  cols: number,
  rows: number,
  tw: number,
  th: number,
  offX: number,
  offY: number,
): WallBox[] {
  const visited = new Array<boolean>(cols * rows).fill(false);
  const solid = (c: number, r: number): boolean =>
    c < cols && r < rows && (data[r * cols + c] ?? 0) !== 0 && !visited[r * cols + c];
  const boxes: WallBox[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!solid(c, r)) continue;
      let w = 1;
      while (solid(c + w, r)) w++;
      let h = 1;
      for (;;) {
        let rowFull = true;
        for (let i = 0; i < w && rowFull; i++) rowFull = solid(c + i, r + h);
        if (!rowFull) break;
        h++;
      }
      for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) visited[y * cols + x] = true;
      boxes.push({
        x: (c + w / 2) * tw - offX,
        y: (r + h / 2) * th - offY,
        hw: (w * tw) / 2,
        hh: (h * th) / 2,
      });
    }
  }
  return boxes;
}

/**
 * Convert untrusted `.tmj` JSON into a `Room`. Pure: the caller reads the file.
 * Throws a descriptive error when the map is invalid.
 */
export function parseRoom(raw: unknown, name = "room"): Room {
  const parsed = roomMapSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`invalid room ${name}: ${parsed.error.message}`);
  try {
    return convert(parsed.data);
  } catch (e) {
    throw new Error(`invalid room ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function convert(map: RoomMap): Room {
  const { tilewidth: tw, tileheight: th } = map;
  const margin = prop(map.properties, "margin") ?? 0;
  if (typeof margin !== "number" || !Number.isInteger(margin) || margin < 0) {
    throw new Error('map property "margin" must be a non-negative integer');
  }
  if (map.width <= 2 * margin || map.height <= 2 * margin) throw new Error("margin exceeds map");
  const offX = margin * tw;
  const offY = margin * th;

  const wallLayers = map.layers.filter((l) => l.type === "tilelayer" && l.name === WALLS_LAYER);
  const walls = wallLayers[0];
  if (wallLayers.length !== 1 || walls?.type !== "tilelayer") {
    throw new Error(`expected exactly one tile layer named "${WALLS_LAYER}"`);
  }
  if (walls.width !== map.width || walls.height !== map.height) {
    throw new Error("walls layer size differs from the map");
  }
  if (walls.data.length !== walls.width * walls.height) {
    throw new Error("walls layer data length does not match its size");
  }

  let playerStart: Point | null = null;
  let dummy: Point | null = null;
  const enemies: EnemySpawn[] = [];
  const doors: DoorSpawn[] = [];
  const doorNames = new Set<string>();
  for (const layer of map.layers) {
    if (layer.type !== "objectgroup") continue;
    for (const o of layer.objects) {
      const kind = o.class ?? o.type ?? "";
      const at = { x: o.x - offX, y: o.y - offY };
      if (
        at.x < 0 ||
        at.y < 0 ||
        at.x > (map.width - 2 * margin) * tw ||
        at.y > (map.height - 2 * margin) * th
      ) {
        throw new Error(`object "${o.name}" (${kind}) lies outside the room`);
      }
      switch (kind) {
        case "player_start":
          if (playerStart) throw new Error("more than one player_start");
          playerStart = at;
          break;
        case "dummy":
          if (dummy) throw new Error("more than one dummy");
          dummy = at;
          break;
        case "enemy": {
          const type = strProp(o, "type");
          if (!ENEMY_TYPES.includes(type)) throw new Error(`unknown enemy type "${type}"`);
          enemies.push({ type, ...at });
          break;
        }
        case "door": {
          if (o.name === "") throw new Error("door needs a name");
          if (doorNames.has(o.name)) throw new Error(`duplicate door "${o.name}"`);
          doorNames.add(o.name);
          doors.push({ name: o.name, to: strProp(o, "to"), toDoor: strProp(o, "toDoor"), ...at });
          break;
        }
        default:
          throw new Error(`unknown object kind "${kind}"`);
      }
    }
  }
  if (!playerStart) throw new Error("missing player_start");

  return {
    width: (map.width - 2 * margin) * tw,
    height: (map.height - 2 * margin) * th,
    walls: mergeWalls(walls.data, map.width, map.height, tw, th, offX, offY),
    playerStart,
    dummy,
    enemies,
    doors,
  };
}
