import { Application, Container, Graphics, Text } from "pixi.js";
import { PLAYER_DATA } from "../sim/data/player";
import { aimToDir } from "../sim/input-frame";
import type { PhysicsWorld } from "../sim/physics/physics-world";
import { PLAYER_RADIUS, ROOM_HEIGHT, ROOM_WALLS, ROOM_WIDTH, WALL_THICKNESS } from "../sim/room";
import type { EntityView, PlayerSnapshot } from "../sim/step";
import type { SlashView } from "./slash-tracker";

const SCALE = 3;

// Slash effect geometry. The hit sensor sits `reach` ahead of the player with radius `hitRadius`,
// so the arc spans from the player out to the far edge of that sensor.
const SLASH_OUTER = PLAYER_DATA.attack.reach + PLAYER_DATA.attack.hitRadius;
const SLASH_INNER = PLAYER_RADIUS + 2;
const SLASH_HALF_ARC = 1.0; // radians each side of the aim
const SLASH_COLOR = 0xfff2b0;

/** Draw the swing effect centred on (0,0); the caller positions the Graphics on the player. */
function drawSlash(g: Graphics, slash: SlashView | null): void {
  g.clear();
  if (!slash) return;
  const dir = aimToDir(slash.aim);
  const base = Math.atan2(dir.y, dir.x);
  const from = base - SLASH_HALF_ARC;
  const to = base + SLASH_HALF_ARC;
  if (slash.phase === "windup") {
    // Anticipation: a faint outline of where the swing will go, brightening as it winds up.
    g.arc(0, 0, SLASH_OUTER, from, to).stroke({
      width: 1,
      color: SLASH_COLOR,
      alpha: 0.15 + slash.progress * 0.3,
    });
    return;
  }
  // Active: the crescent sweeps across the arc. Recovery: the finished arc fades out.
  const sweepTo = slash.phase === "active" ? from + (to - from) * slash.progress : to;
  const alpha = slash.phase === "active" ? 0.95 : 0.7 * (1 - slash.progress);
  if (alpha <= 0 || sweepTo <= from) return;
  g.arc(0, 0, SLASH_OUTER, from, sweepTo)
    .arc(0, 0, SLASH_INNER, sweepTo, from, true)
    .closePath()
    .fill({ color: SLASH_COLOR, alpha });
}

export interface Renderer {
  draw(
    prev: PlayerSnapshot,
    cur: PlayerSnapshot,
    alpha: number,
    others: EntityView[],
    slash: SlashView | null,
  ): void;
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
  const slashFx = new Graphics();
  const debug = new Graphics();
  debug.visible = false;
  const entities = new Container();
  const sprites = new Map<number, Graphics>();
  stage.addChild(floor, walls, entities, player, slashFx, debug);

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
    draw(prev, cur, alpha, others, slash) {
      player.position.set(prev.x + (cur.x - prev.x) * alpha, prev.y + (cur.y - prev.y) * alpha);
      slashFx.position.copyFrom(player.position);
      drawSlash(slashFx, slash);
      player.tint = cur.frozen > 0 ? 0xff8080 : 0xffffff;
      const live = new Set<number>();
      for (const o of others) {
        live.add(o.id);
        let g = sprites.get(o.id);
        if (!g) {
          g = new Graphics().circle(0, 0, o.radius).fill(o.ai ? 0xd94a4a : 0xc9743a);
          sprites.set(o.id, g);
          entities.addChild(g);
        }
        g.position.set(o.x, o.y);
        // Render-only cues: hit flash, and a yellow warning tint while a chaser telegraphs.
        g.tint = o.flash ? 0xffffff : o.ai === "telegraph" ? 0xffee55 : 0xcccccc;
        g.alpha = o.flash ? 1 : 0.9;
      }
      for (const [id, g] of sprites) {
        if (live.has(id)) continue;
        g.destroy();
        sprites.delete(id);
      }
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
