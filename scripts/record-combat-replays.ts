/**
 * Records the combat scenario replays with a simple bot: `pnpm exec tsx scripts/record-combat-replays.ts <seed> <clear|die> <out.json>`.
 * Re-run it (and commit the output under tests/fixtures/) whenever gameplay changes break them.
 */
import { writeFileSync } from "node:fs";
import { type InputFrame, NO_INPUT, quantizeAim } from "../src/sim/input-frame";
import { createRapierWorld, initPhysics } from "../src/sim/physics/rapier-world";
import { buildReplay } from "../src/sim/replay";
import { createSimState, entityViews, step } from "../src/sim/step";

await initPhysics();
const seed = Number(process.argv[2] ?? 7);
const mode = process.argv[3] ?? "clear";
const out = process.argv[4];
let s = createSimState(createRapierWorld(), seed);
const frames: InputFrame[] = [];
for (let t = 0; t < 4000 && !s.cleared && !s.player.dead; t++) {
  const me = s.player;
  const targets = entityViews(s).filter((v) => !v.projectile);
  let best = targets[0];
  let bd = Number.POSITIVE_INFINITY;
  for (const v of targets) {
    const d = Math.hypot(v.x - me.x, v.y - me.y);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  const f: InputFrame = { ...NO_INPUT };
  if (mode === "die") {
    f.left = t % 2 === 0; // dither near the start and let the enemies win
  } else if (best) {
    const dx = best.x - me.x;
    const dy = best.y - me.y;
    f.aim = quantizeAim(dx, dy);
    if (bd - best.radius < 17) f.attack = true;
    else {
      f.right = dx > 2;
      f.left = dx < -2;
      f.down = dy > 2;
      f.up = dy < -2;
    }
  }
  frames.push(f);
  s = step(s, f);
}
console.log({
  tick: s.tick,
  cleared: s.cleared,
  dead: s.player.dead,
  hp: s.player.hp,
  left: entityViews(s).filter((v) => !v.projectile).length,
});
if (out) writeFileSync(out, JSON.stringify(buildReplay(seed, frames, s)));
