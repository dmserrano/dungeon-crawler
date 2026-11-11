import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseRoom } from "../sim/data/room";
import type { Room } from "../sim/room";

const ROOMS_DIR = join(import.meta.dirname, "../../data/rooms");

/** Read and parse one `.tmj` file (Node only; the sim itself does no file I/O). */
export function loadRoomFile(path: string): Room {
  return parseRoom(JSON.parse(readFileSync(path, "utf8")), basename(path));
}

export function loadRoomByName(name: string): Room {
  return loadRoomFile(join(ROOMS_DIR, `${name}.tmj`));
}

export function roomFiles(): string[] {
  return readdirSync(ROOMS_DIR)
    .filter((f) => f.endsWith(".tmj"))
    .sort()
    .map((f) => join(ROOMS_DIR, f));
}
