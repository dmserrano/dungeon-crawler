/** One tick of player input. An `InputFrame[]` is the replay format. */
export interface InputFrame {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** Aim direction, integer 0-255 (256 steps per full turn). 0 = +x, increasing clockwise on screen (+y is down). */
  aim: number;
  attack: boolean;
  dash: boolean;
}

export const NO_INPUT: InputFrame = {
  up: false,
  down: false,
  left: false,
  right: false,
  aim: 0,
  attack: false,
  dash: false,
};

const AIM_STEPS = 256;

/** Quantize a vector (from the player to the cursor) to an aim step 0-255. Zero vector gives 0. */
export function quantizeAim(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  const turns = Math.atan2(dy, dx) / (2 * Math.PI);
  return ((Math.round(turns * AIM_STEPS) % AIM_STEPS) + AIM_STEPS) % AIM_STEPS;
}

/** Unit vectors per aim step, rounded so results do not depend on last-ulp libm differences. */
const AIM_DIRS: readonly { x: number; y: number }[] = Array.from({ length: AIM_STEPS }, (_, i) => {
  const a = (i / AIM_STEPS) * 2 * Math.PI;
  return { x: Math.round(Math.cos(a) * 1e6) / 1e6, y: Math.round(Math.sin(a) * 1e6) / 1e6 };
});

export function aimToDir(aim: number): { x: number; y: number } {
  return AIM_DIRS[((aim % AIM_STEPS) + AIM_STEPS) % AIM_STEPS] as { x: number; y: number };
}
