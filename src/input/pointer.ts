import { type InputFrame, quantizeAim } from "../sim/input-frame";

export interface Vec2 {
  x: number;
  y: number;
}

export interface PointerInput {
  /** Aim step (0-255) from `from` (player, room coords) to the cursor, plus the attack button. */
  sample(from: Vec2): Pick<InputFrame, "aim" | "attack">;
  dispose(): void;
}

/**
 * Mouse aim + attack (left button). `toRoom` converts client coordinates to room coordinates.
 * Until the mouse moves, the cursor is assumed to be at the origin of the room.
 */
export function createPointerInput(
  target: Window,
  toRoom: (clientX: number, clientY: number) => Vec2,
): PointerInput {
  let cursor: Vec2 = { x: 0, y: 0 };
  let attack = false;
  const onMove = (e: MouseEvent) => {
    cursor = toRoom(e.clientX, e.clientY);
  };
  const onDown = (e: MouseEvent) => {
    if (e.button === 0) attack = true;
  };
  const onUp = (e: MouseEvent) => {
    if (e.button === 0) attack = false;
  };
  const onBlur = () => {
    attack = false;
  };
  target.addEventListener("mousemove", onMove);
  target.addEventListener("mousedown", onDown);
  target.addEventListener("mouseup", onUp);
  target.addEventListener("blur", onBlur);
  return {
    sample: (from) => ({ aim: quantizeAim(cursor.x - from.x, cursor.y - from.y), attack }),
    dispose() {
      target.removeEventListener("mousemove", onMove);
      target.removeEventListener("mousedown", onDown);
      target.removeEventListener("mouseup", onUp);
      target.removeEventListener("blur", onBlur);
    },
  };
}
