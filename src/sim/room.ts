import { PLAYER_DATA } from "./data/player";

/** World units are pixels. Rooms are loaded from Tiled maps (see `src/sim/data/room.ts`). */
export const WALL_THICKNESS = 16;
export const PLAYER_RADIUS = PLAYER_DATA.radius;

export interface WallBox {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface EnemySpawn extends Point {
  /** Key in `data/enemies.json`. */
  type: string;
}

/** Parsed and validated but not yet acted on (doors come in a later slice). */
export interface DoorSpawn extends Point {
  name: string;
  to: string;
  toDoor: string;
}

/** A loaded room. The playable area is [0, width] x [0, height]; walls may lie outside it. */
export interface Room {
  width: number;
  height: number;
  walls: readonly WallBox[];
  playerStart: Point;
  dummy: Point | null;
  enemies: readonly EnemySpawn[];
  doors: readonly DoorSpawn[];
}
