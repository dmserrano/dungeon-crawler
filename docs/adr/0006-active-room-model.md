# 0006: Active-room model, transitions and door locking

Status: accepted (2026-11-10)

## Context

SPEC.md section 2 says the sim simulates only the active room, in an exploratory Isaac/Zelda style: the player can walk back through any door. The rooms and content PRD needs transitions, locking and a minimum of persistent state. Replays must reproduce all of it.

## Decision

- **One active room.** Entering a new room tears down the old room's bodies, enemies and projectiles and builds the new room from its `Room` data. Only the active room is simulated.
- **Sim-owned transition.** Touching a door sensor starts a transition state of about 20 ticks. Player input is ignored while it runs. At the midpoint the sim swaps the active room and places the player at the paired door (`toDoor`), nudged inward. Enemies spawn when the transition ends. The renderer reads the transition state and draws a fade; it never owns timing.
- **Door locking.** Entering a room with live enemies locks every door in it, including the one the player came through. All doors unlock when the existing `cleared` event fires. A room with no enemies never locks. Because a locked room cannot be left, a room is only ever untouched or cleared.
- **Run record.** The only state carried between rooms is: current room id, the set of cleared room ids, and the player's HP and dash cooldown (no heal on clear). A cleared room spawns nothing on re-entry and its doors stay open. Projectiles are discarded on transition.
- **State hash.** `hashState` covers the run record plus the active room's entities (sorted by id).
- **RNG.** One run-level `src/sim/rng` stream, created from the seed, continues across rooms.
- **Clear-lock is a special case for now.** Locking is hard-wired to "room cleared". The puzzles PRD generalizes it into the signal/target system, where "room cleared" becomes one signal.

## Consequences

Memory per run is tiny and replay-safe. Fleeing a fight to reset it is impossible by design. Remembering individual dead enemies, pickups or a visited-room set (for a minimap) is out of scope and needs a later change. The signals PRD will replace the hard-wired lock code.
