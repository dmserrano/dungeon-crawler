# 0002: Room-template graph procgen; AI design-time only

Status: accepted (2026-11-09)

## Context

Zelda-style puzzles must be solvable, which BSP and cellular-automata generators cannot guarantee. Runs should be reproducible by seed.

## Decision

- Rooms are hand-authored in Tiled (`.tmj`) and validated with Zod. A seeded generator picks and connects them. A validator checks connectivity and key/switch reachability.
- Puzzles are data using a generic signal/target system.
- No generative AI at runtime. Generative AI may produce tilesets/room templates offline, reviewed and committed as data. Jev (typesafe.ai) is a typed-decision model, not a level generator, and is out of scope.

## Consequences

Authoring cost per room, but solvable, reproducible, testable levels. Enemy AI is FSM + A* (no runtime ML/LLM).
