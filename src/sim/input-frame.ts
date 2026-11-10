/** One tick of player input. An `InputFrame[]` is the replay format. */
export interface InputFrame {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export const NO_INPUT: InputFrame = { up: false, down: false, left: false, right: false };
