# 0007: Replay format v3 for multi-room runs

Status: accepted (2026-11-10)

## Context

Replay v2 (`SIM_VERSION` 2) assumes a single hard-coded room: the header is a seed plus run-length-encoded inputs plus a final hash. With Tiled rooms and door transitions (ADR 0005, ADR 0006) a replay must also say which floor it ran on, since the same inputs mean nothing without the room data.

## Decision

- The replay header gains `floor`, the id of a floor file in `data/floors/`. The floor file names the start room. The input encoding (`[mask, aim, count]`) is unchanged.
- `Replay.version` becomes 3. `parseReplay` rejects v2 files with a "format changed" error, as it did for v1; re-record them.
- The two combat acceptance replays are re-recorded against a floor whose only room is `test-arena`, and their hashes updated in `tests/replay.combat-*.test.ts`.
- `SIM_VERSION` bumps with the slice that introduces transitions (the doors slice), not with the loader slice. The loader slice must leave hashes unchanged (ADR 0005).
- `pnpm replay` and the F2/F3 exports write and read v3.

## Consequences

Old replays stop verifying and must be re-recorded once more. Replays are tied to room files and the floor file, so changing a room's layout changes behavior and needs a `SIM_VERSION` bump per `AGENTS.md`.
