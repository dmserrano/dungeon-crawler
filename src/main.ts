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
  let cur = createSimState(world, seedFromSearch(window.location.search));
  let prev = cur;
  const input = createKeyboardInput(window);
  const renderer = await createRenderer(host, world);
  const fps = createFpsMeter();

  window.addEventListener("keydown", (e) => {
    if (e.code === "F1") {
      e.preventDefault();
      renderer.setDebug(!renderer.debugOn);
    }
  });

  const loop = createFixedLoop(() => {
    prev = cur;
    cur = step(cur, input.sample());
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
