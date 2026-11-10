/** Hard-coded rectangular room (Tiled loading comes in a later slice). World units are pixels. */
export const ROOM_WIDTH = 320;
export const ROOM_HEIGHT = 224;
export const WALL_THICKNESS = 16;
export const PLAYER_RADIUS = 6;
export const PLAYER_START = { x: ROOM_WIDTH / 2, y: ROOM_HEIGHT / 2 };

export interface WallBox {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

const T = WALL_THICKNESS / 2;

/** Four walls whose inner faces bound [0, ROOM_WIDTH] x [0, ROOM_HEIGHT]. */
export const ROOM_WALLS: readonly WallBox[] = [
  { x: ROOM_WIDTH / 2, y: -T, hw: ROOM_WIDTH / 2 + WALL_THICKNESS, hh: T },
  { x: ROOM_WIDTH / 2, y: ROOM_HEIGHT + T, hw: ROOM_WIDTH / 2 + WALL_THICKNESS, hh: T },
  { x: -T, y: ROOM_HEIGHT / 2, hw: T, hh: ROOM_HEIGHT / 2 },
  { x: ROOM_WIDTH + T, y: ROOM_HEIGHT / 2, hw: T, hh: ROOM_HEIGHT / 2 },
];
