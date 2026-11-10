import { Application, Container, Graphics, Text } from "pixi.js";
import type { PhysicsWorld } from "../sim/physics/physics-world";
import { PLAYER_RADIUS, ROOM_HEIGHT, ROOM_WALLS, ROOM_WIDTH, WALL_THICKNESS } from "../sim/room";
import type { PlayerSnapshot } from "../sim/step";

const SCALE = 3;

export interface Renderer {
  draw(prev: PlayerSnapshot, cur: PlayerSnapshot, alpha: number): void;
  setDebug(on: boolean): void;
  setStats(text: string): void;
  /** Convert client (page) coordinates to room coordinates. */
  toRoom(clientX: number, clientY: number): { x: number; y: number };
  readonly debugOn: boolean;
}

export async function createRenderer(host: HTMLElement, world: PhysicsWorld): Promise<Renderer> {
  const margin = WALL_THICKNESS;
  const app = new Application();
  await app.init({
    width: (ROOM_WIDTH + margin * 2) * SCALE,
    height: (ROOM_HEIGHT + margin * 2) * SCALE,
    background: 0x14121a,
    antialias: false,
    autoStart: false,
  });
  host.appendChild(app.canvas);

  const stage = new Container();
  stage.scale.set(SCALE);
  stage.position.set(margin * SCALE, margin * SCALE);
  app.stage.addChild(stage);

  const floor = new Graphics().rect(0, 0, ROOM_WIDTH, ROOM_HEIGHT).fill(0x2b2838);
  const walls = new Graphics();
  for (const w of ROOM_WALLS) {
    walls.rect(w.x - w.hw, w.y - w.hh, w.hw * 2, w.hh * 2).fill(0x58506e);
  }
  const player = new Graphics().circle(0, 0, PLAYER_RADIUS).fill(0xe8c547);
  const debug = new Graphics();
  debug.visible = false;
  stage.addChild(floor, walls, player, debug);

  const stats = new Text({
    text: "",
    style: { fill: 0xffffff, fontSize: 14, fontFamily: "monospace" },
  });
  stats.position.set(6, 4);
  stats.visible = false;
  app.stage.addChild(stats);

  let debugOn = false;
  return {
    get debugOn() {
      return debugOn;
    },
    draw(prev, cur, alpha) {
      player.position.set(prev.x + (cur.x - prev.x) * alpha, prev.y + (cur.y - prev.y) * alpha);
      if (debugOn) {
        debug.clear();
        for (const s of world.debugShapes()) {
          if (s.kind === "box") debug.rect(s.x - s.hw, s.y - s.hh, s.hw * 2, s.hh * 2);
          else debug.circle(s.x, s.y, s.r);
          debug.stroke({ width: 1 / SCALE, color: s.dynamic ? 0x00ff66 : 0xff3366 });
        }
      }
      app.render();
    },
    setDebug(on) {
      debugOn = on;
      debug.visible = on;
      stats.visible = on;
    },
    setStats(text) {
      stats.text = text;
    },
    toRoom(clientX, clientY) {
      const r = app.canvas.getBoundingClientRect();
      // Canvas CSS size may differ from its pixel size; normalise, then undo scale and margin.
      const px = ((clientX - r.left) / (r.width || 1)) * app.canvas.width;
      const py = ((clientY - r.top) / (r.height || 1)) * app.canvas.height;
      return { x: px / SCALE - margin, y: py / SCALE - margin };
    },
  };
}
