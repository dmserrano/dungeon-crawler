# 0005: Tiled room integration

Status: accepted (2026-11-10)

## Context

SPEC.md section 5 says rooms are authored in Tiled (`.tmj`) and validated by Zod, with CI checking that every room loads. The combat PRD (#26) used a hard-coded room in `src/sim/room.ts`. The rooms and content PRD replaces it. The sim must stay headless and deterministic (SPEC section 4, rules 2 and 6), and the game makes no runtime network calls.

## Decision

- **Fixed room size.** Every room is 20x14 tiles of 16 px (320x224). World units stay pixels. No camera. Variable-size rooms need a new ADR.
- **Files.** Rooms live in `data/rooms/*.tmj`. The tileset is an external `.tsx` that points at the Kenney image. The sim never reads art.
- **Parsed room, no I/O in the sim.** `src/sim/data/` owns the Zod schema and a pure function from parsed `.tmj` JSON to a `Room` object. The sim receives a `Room`; it never touches files. The game layer loads `data/rooms/*.tmj` at build time with Vite `import.meta.glob`. Tests and `pnpm replay` read the same files with `fs`.
- **Walls from tiles.** A `walls` tile layer marks solid tiles. The loader scans row-major and greedily merges adjacent solid tiles into rectangles, one `createStaticBox` per rectangle, in that fixed order so body creation is reproducible. Tile classes are floor and wall only. Pits and hazards are not supported yet.
- **Objects.** One object layer:
  - `player_start`
  - `enemy` with property `type`, a key in `data/enemies.json`. Tiled never defines stats.
  - `dummy`
  - `door` with `name`, `to` (room id) and `toDoor` (the paired door's name in that room)
- **Validation.** The Zod loader rejects unknown enemy types and malformed objects. A CI test loads every `data/rooms/*.tmj`. A floor validator (floor file `data/floors/*.json` names the start room and room ids) checks that every `to` room and `toDoor` exists, links are symmetric, and all rooms are connected to the start. Cycles are allowed.
- **Slice 1 migration.** The first slice loads `data/rooms/test-arena.tmj` with bodies and spawns identical to today's hard-coded room, so the combat replays and their hashes stay valid and `SIM_VERSION` does not change.

## Consequences

Rooms are data, and a bad door link fails CI before it reaches the sim. Tile art can change without touching the sim. Rooms are tied to one screen size. Greedy merging adds a small loader to maintain. The floor validator is the base the procgen PRD extends with key and switch reachability.
