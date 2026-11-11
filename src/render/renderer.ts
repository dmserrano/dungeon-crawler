import { Application, Container, Graphics, Sprite, Text } from "pixi.js";
import type { RoomMap } from "../../data/schemas/room";
import { PLAYER_DATA } from "../sim/data/player";
import { aimToDir } from "../sim/input-frame";
import type { PhysicsWorld } from "../sim/physics/physics-world";
import { PLAYER_RADIUS, type Room, WALL_THICKNESS } from "../sim/room";
import type { EntityView, PlayerSnapshot } from "../sim/step";
import { loadArt } from "./art";
import { doorPlacement } from "./doors";
import type { SlashView } from "./slash-tracker";

const SCALE = 3;
/** Tiled stores flip flags in the top bits of a tile gid. */
const GID_MASK = 0x0fffffff;

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

const HITBOX_COLOR = 0xff9f1c; // active attack sensors and enemy projectiles
const HURTBOX_COLOR = 0x35c9ff; // bodies that can take damage (player, enemies, dummy)

/** Debug-only: hitboxes (orange) and hurtboxes (cyan). Reads render state; adds no sim state. */
function drawCombatBoxes(
  g: Graphics,
  cur: PlayerSnapshot,
  at: { x: number; y: number },
  others: EntityView[],
  slash: SlashView | null,
): void {
  const width = 1.5 / SCALE;
  g.circle(at.x, at.y, PLAYER_RADIUS).stroke({ width, color: HURTBOX_COLOR });
  if (slash && cur.attack === "active") {
    const dir = aimToDir(slash.aim);
    const { reach, hitRadius } = PLAYER_DATA.attack;
    g.circle(at.x + dir.x * reach, at.y + dir.y * reach, hitRadius).stroke({
      width,
      color: HITBOX_COLOR,
    });
  }
  for (const o of others) {
    g.circle(o.x, o.y, o.radius).stroke({
      width,
      color: o.projectile ? HITBOX_COLOR : HURTBOX_COLOR,
    });
  }
}

export interface Renderer {
  draw(
    prev: PlayerSnapshot,
    cur: PlayerSnapshot,
    alpha: number,
    others: EntityView[],
    slash: SlashView | null,
    /** Black overlay opacity 0-1 (door transitions). */
    fade: number,
    /** True while the room's doors are locked shut (live enemies). */
    locked: boolean,
  ): void;
  /** Swap the drawn tiles and canvas size after a room transition. */
  setRoom(room: Room, map: RoomMap): void;
  setDebug(on: boolean): void;
  setStats(text: string): void;
  /** Convert client (page) coordinates to room coordinates. */
  toRoom(clientX: number, clientY: number): { x: number; y: number };
  readonly debugOn: boolean;
}

export async function createRenderer(
  host: HTMLElement,
  world: PhysicsWorld,
  room: Room,
  map: RoomMap,
): Promise<Renderer> {
  const margin = WALL_THICKNESS;
  const app = new Application();
  await app.init({
    width: (room.width + margin * 2) * SCALE,
    height: (room.height + margin * 2) * SCALE,
    background: 0x14121a,
    antialias: false,
    autoStart: false,
  });
  host.appendChild(app.canvas);

  const stage = new Container();
  stage.scale.set(SCALE);
  stage.position.set(margin * SCALE, margin * SCALE);
  app.stage.addChild(stage);

  const art = await loadArt();
  const sprite = (tile: number): Sprite => {
    const s = new Sprite(art.tile(tile));
    s.anchor.set(0.5);
    return s;
  };
  // Tile layers are drawn as-is (render only); the sim builds walls from the "walls" layer data.
  const tiles = new Container();
  const buildTiles = (m: RoomMap): void => {
    for (const old of tiles.removeChildren()) old.destroy();
    const marginTiles = m.properties.find((p) => p.name === "margin")?.value;
    const offset = typeof marginTiles === "number" ? marginTiles : 0;
    for (const layer of m.layers) {
      if (layer.type !== "tilelayer") continue;
      layer.data.forEach((gid, i) => {
        const id = gid & GID_MASK;
        if (id === 0) return;
        const s = new Sprite(art.tile(id - 1));
        s.position.set(
          ((i % layer.width) - offset) * m.tilewidth,
          (Math.floor(i / layer.width) - offset) * m.tileheight,
        );
        tiles.addChild(s);
      });
    }
  };
  buildTiles(map);

  // Doors are drawn over the wall tiles (render only; the sim has no gap in the wall). Art swaps to
  // the shut door while the room is locked.
  const doorLayer = new Container();
  let doorHalves: { left: Sprite; right: Sprite }[] = [];
  let doorsLocked = false;
  const applyDoorArt = (): void => {
    const s = art.manifest.sprites;
    for (const d of doorHalves) {
      d.left.texture = art.tile(doorsLocked ? s.doorLockedLeft : s.doorOpenLeft);
      d.right.texture = art.tile(doorsLocked ? s.doorLockedRight : s.doorOpenRight);
    }
  };
  const buildDoors = (r: Room): void => {
    for (const old of doorLayer.removeChildren()) old.destroy({ children: true });
    doorHalves = r.doors.map((door) => {
      const at = doorPlacement(r, door);
      const pair = new Container();
      pair.position.set(at.x, at.y);
      pair.rotation = at.rotation;
      const left = sprite(0);
      const right = sprite(0);
      left.position.set(-8, 0);
      right.position.set(8, 0);
      pair.addChild(left, right);
      doorLayer.addChild(pair);
      return { left, right };
    });
    applyDoorArt();
  };
  buildDoors(room);
  const fadeOverlay = new Graphics();
  const player = sprite(art.manifest.sprites.player);
  const slashFx = new Graphics();
  const debug = new Graphics();
  debug.visible = false;
  const entities = new Container();
  const sprites = new Map<number, Sprite>();
  stage.addChild(tiles, doorLayer, entities, player, slashFx, debug, fadeOverlay);
  let size = { w: room.width, h: room.height };

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
    setRoom(next, nextMap) {
      buildTiles(nextMap);
      buildDoors(next);
      size = { w: next.width, h: next.height };
      app.renderer.resize((next.width + margin * 2) * SCALE, (next.height + margin * 2) * SCALE);
    },
    draw(prev, cur, alpha, others, slash, fade, locked) {
      if (locked !== doorsLocked) {
        doorsLocked = locked;
        applyDoorArt();
      }
      fadeOverlay.clear();
      if (fade > 0) {
        fadeOverlay
          .rect(-margin, -margin, size.w + margin * 2, size.h + margin * 2)
          .fill({ color: 0x000000, alpha: fade });
      }
      player.position.set(prev.x + (cur.x - prev.x) * alpha, prev.y + (cur.y - prev.y) * alpha);
      slashFx.position.copyFrom(player.position);
      drawSlash(slashFx, slash);
      player.tint = cur.frozen > 0 ? 0xff8080 : 0xffffff;
      const live = new Set<number>();
      for (const o of others) {
        live.add(o.id);
        let g = sprites.get(o.id);
        if (!g) {
          const s = art.manifest.sprites;
          g = sprite(o.projectile ? s.projectile : o.ranged ? s.ranged : o.ai ? s.chaser : s.dummy);
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
        drawCombatBoxes(debug, cur, player.position, others, slash);
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
