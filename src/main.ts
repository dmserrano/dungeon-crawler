import { downloadText } from "./debug/download";
import { createLogger } from "./debug/logger";
import { createRecorder } from "./debug/recorder";
import { createFpsMeter } from "./debug/stats";
import { createFixedLoop } from "./game/loop";
import { seedFromSearch } from "./game/seed";
import { createKeyboardInput } from "./input/keyboard";
import { createRenderer } from "./render/renderer";
import { createRapierWorld, initPhysics } from "./sim/physics/rapier-world";
import { createSimState, step } from "./sim/step";

async function main() {
  const host = document.getElementById("app");
  if (!host) return;
  await initPhysics();

  const world = createRapierWorld();
  const seed = seedFromSearch(window.location.search);
  const log = createLogger({ capacity: 500 });
  const recorder = createRecorder();
  let cur = createSimState(world, seed);
  log.info("session start", { seed });
  let prev = cur;
  const input = createKeyboardInput(window);
  const renderer = await createRenderer(host, world);
  const fps = createFpsMeter();

  window.addEventListener("keydown", (e) => {
    if (e.code === "F1") {
      e.preventDefault();
      renderer.setDebug(!renderer.debugOn);
    } else if (e.code === "F2") {
      e.preventDefault();
      const replay = recorder.build(cur);
      downloadText(
        `replay-seed${seed}-${replay.ticks}t-${replay.finalHash}.json`,
        JSON.stringify(replay),
      );
      log.info("replay exported", { ticks: replay.ticks, finalHash: replay.finalHash });
    }
  });

  const loop = createFixedLoop(() => {
    const frame = input.sample();
    recorder.record(frame);
    prev = cur;
    cur = step(cur, frame);
  });

  const frame = (now: number) => {
    const alpha = loop.frame(now);
    renderer.draw(prev.player, cur.player, alpha);
    const rate = fps.frame(now);
    if (renderer.debugOn) {
      renderer.setStats(`FPS ${rate.toFixed(0)}  entities ${world.bodyCount()}  tick ${cur.tick}`);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
