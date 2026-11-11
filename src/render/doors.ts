/** Render-only door placement. Doors are points on the room edge; the art is a two-tile arch. */

const TILE = 16;

export interface DoorPlacement {
  /** Centre of the two-tile door, in room coordinates (inside the wall ring, past the room edge). */
  x: number;
  y: number;
  /** Radians. The art faces north (arch on top); other walls rotate it so the arch faces outward. */
  rotation: number;
}

/**
 * Where to draw a door: centred on the wall tile row or column behind the door point, rotated so
 * the arch faces away from the room. The door point sits on the room edge (the sim does not need
 * a gap in the wall: the arch is a picture over the wall tiles).
 */
export function doorPlacement(
  room: { width: number; height: number },
  door: { x: number; y: number },
): DoorPlacement {
  const half = TILE / 2;
  const toNorth = door.y;
  const toSouth = room.height - door.y;
  const toWest = door.x;
  const toEast = room.width - door.x;
  const nearest = Math.min(toNorth, toSouth, toWest, toEast);
  if (nearest === toNorth) return { x: door.x, y: door.y - half, rotation: 0 };
  if (nearest === toSouth) return { x: door.x, y: door.y + half, rotation: Math.PI };
  if (nearest === toWest) return { x: door.x - half, y: door.y, rotation: -Math.PI / 2 };
  return { x: door.x + half, y: door.y, rotation: Math.PI / 2 };
}
