export type Action = "up" | "down" | "left" | "right" | "dash";

/** Action map: physical key -> action. Gamepad bindings will slot in here later. */
export const KEY_BINDINGS: Readonly<Record<string, Action>> = {
  KeyW: "up",
  KeyS: "down",
  KeyA: "left",
  KeyD: "right",
  Space: "dash",
};

export interface KeyboardInput {
  /** Sample which actions are currently held. */
  sample(): Readonly<Record<Action, boolean>>;
  dispose(): void;
}

export function createKeyboardInput(target: Window): KeyboardInput {
  const held = new Set<Action>();
  const onDown = (e: KeyboardEvent) => {
    const a = KEY_BINDINGS[e.code];
    if (a) {
      if (e.code === "Space") e.preventDefault(); // don't scroll the page
      held.add(a);
    }
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
      dash: held.has("dash"),
    }),
    dispose() {
      target.removeEventListener("keydown", onDown);
      target.removeEventListener("keyup", onUp);
      target.removeEventListener("blur", onBlur);
    },
  };
}
