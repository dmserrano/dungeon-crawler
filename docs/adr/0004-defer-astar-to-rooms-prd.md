# 0004: Defer A* pathfinding to the rooms PRD

Status: superseded by ADR 0008 (2026-11-10)

## Context

SPEC.md section 5 says enemy AI uses a finite state machine per behavior plus A* on the room tile grid. The combat PRD (#26) runs on the existing hard-coded open test room, which has no tile grid yet (rooms arrive with Tiled in a later PRD).

## Decision

Combat enemies use direct steering toward the target plus simple wall avoidance (raycast through the `PhysicsWorld` adapter). A* on the tile grid is implemented in the rooms/content PRD, when real room layouts with obstacles exist. The state machines are unchanged by this: only the "move toward target" step is swapped.

## Consequences

Enemies can get stuck on concave obstacles until A* lands, which is acceptable in an open test room. SPEC.md section 5 still describes the end state; this ADR records the temporary deviation.
