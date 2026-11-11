import type { InputFrame } from "../sim/input-frame";
import { buildReplay, type Replay } from "../sim/replay";
import type { SimState } from "../sim/step";

export interface Recorder {
  /** Call once per sim tick with the frame that was just stepped. */
  record(frame: InputFrame): void;
  /** Build a replay from everything recorded so far; `finalState` is the state after the last frame. */
  build(finalState: SimState): Replay;
  readonly length: number;
}

export function createRecorder(floor: string): Recorder {
  const frames: InputFrame[] = [];
  return {
    record: (f) => {
      frames.push({ ...f });
    },
    build: (finalState) => buildReplay(floor, finalState.seed, frames, finalState),
    get length() {
      return frames.length;
    },
  };
}
