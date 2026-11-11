import { buildIssueUrl } from "./debug/bug-report";
import { downloadText } from "./debug/download";
import { installErrorCapture } from "./debug/error-capture";
import { createLogger } from "./debug/logger";
import { createRecorder } from "./debug/recorder";
import {
  createFpsMeter,
  describeCombat,
  describeEnemies,
  describeProjectiles,
} from "./debug/stats";
import { createFixedLoop } from "./game/loop";
import { loadFloor, loadRoom, loadRoomMap } from "./game/rooms";
import { seedFromSearch } from "./game/seed";
import { createKeyboardInput } from "./input/keyboard";
import { createPointerInput } from "./input/pointer";
import { createRenderer } from "./render/renderer";
import { createSlashTracker } from "./render/slash-tracker";
import type { InputFrame } from "./sim/input-frame";
import { createRapierWorld, initPhysics } from "./sim/physics/rapier-world";
import { SIM_VERSION } from "./sim/replay";
import { transitionFade } from "./sim/run";
import { createSimState, entityViews, step } from "./sim/step";

async function main() {
  const host = document.getElementById("app");
  if (!host) return;
  await initPhysics();

  const world = createRapierWorld();
  const seed = seedFromSearch(window.location.search);
  const log = createLogger({ capacity: 500 });
  installErrorCapture(window, log);
  const floor = loadFloor("mini");
  const recorder = createRecorder(floor.id);
  const room = loadRoom(floor.start);
  let cur = createSimState(world, seed, room, { roomId: floor.start, rooms: loadRoom });
  log.info("session start", { seed, floor: floor.id });
  let prev = cur;
  const keys = createKeyboardInput(window);
  const renderer = await createRenderer(host, world, room, loadRoomMap(floor.start));
  const pointer = createPointerInput(window, renderer.toRoom);
  const fps = createFpsMeter();
  const slash = createSlashTracker();

  const exportReplay = (ext: "json" | "txt") => {
    const replay = recorder.build(cur);
    downloadText(
      `replay-seed${seed}-${replay.ticks}t-${replay.finalHash}.${ext}`,
      JSON.stringify(replay),
      ext === "json" ? "application/json" : "text/plain",
    );
    log.info("replay exported", { ticks: replay.ticks, finalHash: replay.finalHash });
    return replay;
  };

  // GitHub may reject raw .json attachments, so bug reports download the replay as .txt.
  const reportBug = () => {
    const replay = exportReplay("txt");
    const url = buildIssueUrl({
      repo: "dmserrano/dungeon-crawler",
      simVersion: SIM_VERSION,
      seed,
      tick: cur.tick,
      hash: replay.finalHash,
      userAgent: navigator.userAgent,
      logLines: log.dump().split("\n"),
    });
    window.open(url, "_blank", "noopener");
  };

  window.addEventListener("keydown", (e) => {
    if (e.code === "F1") {
      e.preventDefault();
      renderer.setDebug(!renderer.debugOn);
    } else if (e.code === "F2") {
      e.preventDefault();
      exportReplay("json");
    } else if (e.code === "F3") {
      e.preventDefault();
      reportBug();
    } else if (e.code === "F4") {
      e.preventDefault();
      loop.setPaused(!loop.paused);
      log.info(loop.paused ? "paused" : "resumed", { tick: cur.tick });
    } else if (e.code === "Period" && !e.repeat) {
      loop.stepOnce(); // no-op unless paused
    }
  });

  const button = document.createElement("button");
  button.textContent = "Report bug (F3)";
  button.style.cssText = "position:fixed;right:8px;bottom:8px;opacity:.7;font:12px sans-serif";
  button.addEventListener("click", reportBug);
  document.body.append(button);

  const loop = createFixedLoop(() => {
    const frame: InputFrame = { ...keys.sample(), ...pointer.sample(cur.player) };
    if (cur.player.dead) return; // the sim is stopped; keep the replay consistent
    recorder.record(frame);
    prev = cur;
    cur = step(cur, frame);
    slash.onTick(frame.aim, prev.player, cur.player);
    if (cur.roomId !== prev.roomId) {
      renderer.setRoom(cur.room, loadRoomMap(cur.roomId));
      log.info("entered room", { room: cur.roomId, tick: cur.tick });
    }
    for (const ev of cur.events) {
      if (ev.kind === "cleared") log.info("room cleared", { tick: cur.tick });
    }
    if (cur.player.dead) log.info("player died", { tick: cur.tick });
  });

  const frame = (now: number) => {
    const alpha = loop.frame(now);
    renderer.draw(
      prev.player,
      cur.player,
      alpha,
      entityViews(cur),
      slash.view(alpha, cur.player.frozen > 0),
      transitionFade(cur.transition),
      cur.locked,
    );
    const rate = fps.frame(now);
    if (renderer.debugOn) {
      const p = cur.player;
      renderer.setStats(
        `FPS ${rate.toFixed(0)}  entities ${world.bodyCount()}  tick ${cur.tick}\n` +
          `${describeCombat({ ...p, cleared: cur.cleared, paused: loop.paused })}\n` +
          `${describeProjectiles(entityViews(cur))}\n` +
          describeEnemies(entityViews(cur)),
      );
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void main();
