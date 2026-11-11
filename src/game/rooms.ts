/// <reference types="vite/client" />
import { parseRoom } from "../sim/data/room";
import type { Room } from "../sim/room";

/** All `data/rooms/*.tmj` as raw text, bundled at build time. */
const files = import.meta.glob<string>("../../data/rooms/*.tmj", {
  eager: true,
  query: "?raw",
  import: "default",
});

export function loadRoom(name: string): Room {
  const text = files[`../../data/rooms/${name}.tmj`];
  if (text === undefined) throw new Error(`unknown room "${name}"`);
  return parseRoom(JSON.parse(text), name);
}
