# 0008: A* on the room wall grid

Status: accepted (2026-11-10). Supersedes ADR 0004.

## Context

ADR 0004 deferred A* until rooms have a tile grid. With the Tiled loader (ADR 0005) every room has a wall layer, so SPEC.md section 5 can now be met.

## Decision

- A* runs on the room's wall grid: 8-way movement, no corner cutting, deterministic tie-breaking by cell index. Pathfinding code is in `src/sim/` and uses no wall-clock time or `Math.random()`.
- Enemies steer directly toward the target when a raycast through the `PhysicsWorld` adapter is clear. Otherwise they follow a cached path stored in their AI memory, recomputed about every 20 ticks, staggered per enemy, with a length cap to bound per-tick cost against the 4 ms budget (`pnpm bench`).
- The wall-avoidance steering from ADR 0004 remains as the fallback when no path exists.
- Enemy state machines are unchanged: only the "move toward target" step changes.
- A unit test places a concave obstacle (the case ADR 0004 said enemies could get stuck on) and asserts the enemy reaches the player.
- The slice bumps `SIM_VERSION` and re-records the combat replays.

## Consequences

Enemies navigate real room layouts. Path caching adds AI memory per enemy. Stale paths for up to the recompute interval are acceptable.
