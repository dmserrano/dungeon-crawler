import { TICK_DT } from "../sim/step";

const MAX_FRAME = 0.25; // clamp so a background tab doesn't trigger a spiral of death

export interface FixedLoop {
  /** Call once per rendered frame with a monotonic timestamp in ms. Returns interpolation alpha. */
  frame(nowMs: number): number;
}

/** Accumulator-based fixed-timestep loop. Time is supplied by the caller, never read here. */
export function createFixedLoop(onTick: () => void): FixedLoop {
  let last: number | null = null;
  let acc = 0;
  return {
    frame(nowMs) {
      if (last !== null) acc += Math.min((nowMs - last) / 1000, MAX_FRAME);
      last = nowMs;
      while (acc >= TICK_DT) {
        onTick();
        acc -= TICK_DT;
      }
      return acc / TICK_DT;
    },
  };
}
