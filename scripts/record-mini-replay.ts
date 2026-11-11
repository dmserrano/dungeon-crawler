/**
 * Records the mini-dungeon acceptance replay with a simple bot: `pnpm exec tsx scripts/record-mini-replay.ts <seed> [out.json]`.
 * The bot clears the three spokes (chasers, ranged, mixed) and returns through the hub each time.
 * Re-run it (and update the asserted values in tests/replay.mini-dungeon.test.ts) whenever
 * gameplay changes break the fixture.
 */
import { writeFileSync } from "node:fs";
import { loadFloorByName, loadRoomByName } from "../src/cli/rooms";
import { type InputFrame, NO_INPUT, quantizeAim } from "../src/sim/input-frame";
import { createRapierWorld, initPhysics } from "../src/sim/physics/rapier-world";
import { buildReplay } from "../src/sim/replay";
import { createSimState, entityViews, type SimState, step } from "../src/sim/step";

await initPhysics();
const seed = Number(process.argv[2] ?? 7);
const out = process.argv[3];
const FLOOR = "mini";
const floor = loadFloorByName(FLOOR);
const SPOKES = ["chasers", "ranged", "mixed"];

function walk(s: SimState, tx: number, ty: number): InputFrame {
  const dx = tx - s.player.x;
  const dy = ty - s.player.y;
  return {
    ...NO_INPUT,
    right: dx > 2,
    left: dx < -2,
    down: dy > 2,
    up: dy < -2,
    aim: quantizeAim(dx, dy),
  };
}

function bot(s: SimState): InputFrame {
  if (s.transition) return NO_INPUT;
  const me = s.player;
  const targets = entityViews(s).filter((v) => !v.projectile);
  if (targets.length > 0) {
    let best = targets[0];
    let bd = Number.POSITIVE_INFINITY;
    for (const v of targets) {
      const d = Math.hypot(v.x - me.x, v.y - me.y);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    if (!best) return NO_INPUT;
    const f = walk(s, best.x, best.y);
    if (bd - best.radius < 17) return { ...NO_INPUT, aim: f.aim, attack: true };
    // Dash in from range: the i-frames carry the bot through the first volley or lunge.
    if (bd > 45 && me.dashCooldown === 0 && !me.dashing) return { ...f, dash: true };
    return f;
  }
  // Room is clear: head for the door that leads on.
  const room = s.room;
  let door = room.doors[0];
  if (s.roomId === floor.start) {
    const next = SPOKES.find((id) => !s.clearedRooms.includes(id));
    if (!next) return NO_INPUT;
    door = room.doors.find((d) => d.to === next);
  }
  return door ? walk(s, door.x, door.y) : NO_INPUT;
}

let s = createSimState(createRapierWorld(), seed, loadRoomByName(floor.start), {
  roomId: floor.start,
  rooms: loadRoomByName,
});
const frames: InputFrame[] = [];
const done = (x: SimState) =>
  x.roomId === floor.start && SPOKES.every((id) => x.clearedRooms.includes(id)) && !x.transition;
for (let t = 0; t < 20000 && !done(s) && !s.player.dead; t++) {
  const f = bot(s);
  frames.push(f);
  const before = s.roomId;
  s = step(s, f);
  if (s.roomId !== before)
    console.log(`tick ${s.tick}: ${before} -> ${s.roomId}, hp ${s.player.hp}`);
}
console.log({
  tick: s.tick,
  room: s.roomId,
  cleared: s.clearedRooms,
  dead: s.player.dead,
  hp: s.player.hp,
  done: done(s),
});
if (out && done(s)) writeFileSync(out, JSON.stringify(buildReplay(FLOOR, seed, frames, s)));
