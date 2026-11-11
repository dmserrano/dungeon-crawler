/// <reference types="vite/client" />
import { type RoomMap, roomMapSchema } from "../../data/schemas/room";
import { parseRoom } from "../sim/data/room";
import type { Room } from "../sim/room";

/** All `data/rooms/*.tmj` as raw text, bundled at build time. */
const files = import.meta.glob<string>("../../data/rooms/*.tmj", {
  eager: true,
  query: "?raw",
  import: "default",
});

function rawRoom(name: string): unknown {
  const text = files[`../../data/rooms/${name}.tmj`];
  if (text === undefined) throw new Error(`unknown room "${name}"`);
  return JSON.parse(text);
}

export function loadRoom(name: string): Room {
  return parseRoom(rawRoom(name), name);
}

/** The Tiled map for rendering (tile layers). The sim never sees this. */
export function loadRoomMap(name: string): RoomMap {
  return roomMapSchema.parse(rawRoom(name));
}
