# 0001: PixiJS v8 + Rapier 2D + miniplex, with our own thin layer

Status: accepted (2026-11-09)

## Context

Top-down action roguelike with knockback, projectiles, pushable props and puzzles. Wants a clean headless sim for tests, replays and agent-driven development.

## Decision

- Render with PixiJS v8 and a thin in-house game layer, not a full framework (Phaser/Excalibur), because their loop/scene/physics coupling fights a headless sim.
- Physics with Rapier 2D (deterministic WASM) behind a `PhysicsWorld` adapter. Fallback: Planck.js. Matter.js rejected.
- ECS with miniplex behind our own thin API. bitECS not needed at ~200 entities.

## Consequences

More up-front engine work than Phaser. In return: testable deterministic sim, swappable physics, a strong showcase for the software-factory workflow. Rapier needs async WASM init.
