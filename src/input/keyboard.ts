import type { InputFrame } from "../sim/input-frame";

export type Action = "up" | "down" | "left" | "right";

/** Action map: physical key -> action. Gamepad bindings will slot in here later. */
export const KEY_BINDINGS: Readonly<Record<string, Action>> = {
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
};

export interface KeyboardInput {
  /** Sample the current action state as this tick's InputFrame. */
  sample(): InputFrame;
  dispose(): void;
}

export function createKeyboardInput(target: Window): KeyboardInput {
  const held = new Set<Action>();
  const onDown = (e: KeyboardEvent) => {
    const a = KEY_BINDINGS[e.code];
    if (a) held.add(a);
  };
  const onUp = (e: KeyboardEvent) => {
    const a = KEY_BINDINGS[e.code];
    if (a) held.delete(a);
  };
  const onBlur = () => held.clear();
  target.addEventListener("keydown", onDown);
  target.addEventListener("keyup", onUp);
  target.addEventListener("blur", onBlur);
  return {
    sample: () => ({
      up: held.has("up"),
      down: held.has("down"),
      left: held.has("left"),
      right: held.has("right"),
    }),
    dispose() {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur);
    },
  };
}
