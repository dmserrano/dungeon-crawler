import { TICK_DT } from "../sim/step";

const MAX_FRAME = 0.25; // clamp so a background tab doesn't trigger a spiral of death

export interface FixedLoop {
  /** Call once per rendered frame with a monotonic timestamp in ms. Returns interpolation alpha. */
  frame(nowMs: number): number;
  /** While paused no time accumulates and no tick runs (so nothing is recorded either). */
  setPaused(paused: boolean): void;
  readonly paused: boolean;
  /** Run exactly one tick now. Only does anything while paused. */
  stepOnce(): boolean;
}

/** Accumulator-based fixed-timestep loop. Time is supplied by the caller, never read here. */
export function createFixedLoop(onTick: () => void): FixedLoop {
  let last: number | null = null;
  let acc = 0;
  let paused = false;
  return {
    get paused() {
      return paused;
    },
    setPaused(p) {
      paused = p;
      acc = 0; // drop partial time so resuming does not burst or double-step
    },
    stepOnce() {
      if (!paused) return false;
      onTick();
      return true;
    },
    frame(nowMs) {
      if (!paused && last !== null) acc += Math.min((nowMs - last) / 1000, MAX_FRAME);
      last = nowMs; // tracked while paused too, so resuming never sees the paused gap
      while (acc >= TICK_DT) {
        onTick();
        acc -= TICK_DT;
      }
      return acc / TICK_DT;
    },
  };
}
