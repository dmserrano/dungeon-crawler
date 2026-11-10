# SPEC: Dungeon Crawler (working title)

Status: **frozen v1** (2026-11-09). Changes require an ADR in `docs/adr/`.

## 1. Purpose

Public side project and showcase of an agent-driven "software factory" workflow. MIT licensed. Free web release. Target: playable vertical slice in ~4 weeks.

## 2. Game

- Single-player, real-time, top-down action **roguelike** (roguelite meta-progression deferred until after first playable).
- Desktop web only. Keyboard + mouse first; gamepad later via the input action map. No mobile/touch, no Steam wrapper in v1.
- Room-by-room screens with transitions (Isaac / classic Zelda). The sim simulates only the active room.
- Controls: WASD move, mouse aim, left-click melee toward cursor, Space dash with brief i-frames. Hits give knockback and hitstop.
- Physics justified by: knockback/impulses, projectiles, pushable/breakable props, enemy separation. Zelda-style puzzles.

## 3. Stack

TypeScript (strict), Vite, pnpm, **PixiJS v8** with our own thin game layer (loop, scenes, input), **Rapier 2D** (`@dimforge/rapier2d`; Planck.js is the fallback if WASM loading is a problem), **miniplex** ECS (behind our own thin API), **Preact** DOM overlay for menus/pause/HUD, Zod, Biome, Vitest, Playwright, GitHub Actions. Deploy to GitHub Pages or itch.io.

## 4. Architecture rules

1. Fixed-timestep simulation (60 Hz), variable-rate render with interpolation.
2. `sim/` is headless: no Pixi, DOM, or `Math.random()`. Import boundaries enforced in CI (Biome restricted imports or dependency-cruiser).
3. Physics is behind a `PhysicsWorld` adapter interface (createBody, raycast, queryAABB, step, events).
4. Systems run in fixed order: input → AI → movement → physics step → collision events → combat/damage → lifecycle → render sync.
5. Seeded deterministic RNG for all gameplay randomness. Same seed + same input log => identical state hash.
6. Data-driven content (enemies, items, rooms) validated by Zod. Event bus from sim to UI/audio/VFX.
7. Object pooling for projectiles/particles. Physics debug draw available.
8. Budget: 60 fps, ~200 active entities per room, mid-range laptop.

## 5. Content & procgen

- Rooms authored in **Tiled** (`.tmj`): tile layers for walls/floors, object layers for spawns, doors, plates, blocks. Zod-validated loader; CI checks every room file loads.
- Procgen = seeded **room-template graph** (hand-authored rooms, including puzzle rooms, connected by a generator) plus a validator for connectivity and key/switch reachability.
- Puzzles = data via a generic **signal/target** system (triggers emit signals; doors/spawners/bridges respond), wired in Tiled object properties. MVP: plate+block -> door, key -> locked door.
- Enemy AI: FSM per behavior id (idle, chase, attack, stagger), types defined in data, A* on the room tile grid. Behavior trees deferred.
- Art: Kenney CC0 16x16 packs only, referenced through an asset manifest. `CREDITS.md` records every asset's source and license.
- **AI usage:** classical game AI only at runtime. Generative AI is design-time only (never a runtime dependency). Jev (typesafe.ai) is out of scope.

## 6. MVP (first playable)

One generated floor of 8-12 rooms; melee + dash; two enemy types (chaser, ranged); one puzzle type (plate+block -> door); key + locked door gating a boss room; death restarts the run.
**Out of MVP:** meta-progression, audio, second puzzle type, persistence beyond current seed and a local best-run record.

## 7. Quality & testing

- CI: typecheck, Biome lint/format, Vitest, determinism/replay tests, room-load check, Playwright boot smoke test. No visual regression in v1.
- Each feature adds one recorded input-log replay as its acceptance test.
- Dev tooling: physics debug-draw toggle, stats overlay (FPS, entity count), `?seed=` URL param, input recording and replay export.

## 8. Software factory

- Build a **thin factory first** (days 1-2): `AGENTS.md` (canonical), `CLAUDE.md` (pointer), CI gates, headless sim-test harness, issue/PR templates, ADR folder, `GLOSSARY.md`. Then the walking skeleton (player moving in a physics room) goes through the pipeline.
- Pipeline: grilling -> PRD issue -> vertical-slice issues -> TDD in a worktree -> PR -> code-review -> human squash-merge to protected `main`.
- GitHub Issues is the backlog. Slice issues use an agent-ready template (goal, acceptance criteria, areas touched, required replay/test; no dependence on local context). A human applies the `agent-ready` label after triage; implementation slices can then be assigned to **Copilot coding agent or `@claude`** (agent-neutral, PR-based). Grilling and PRDs stay local and interactive.
- `.github/workflows/copilot-setup-steps.yml` and CI share one install script. `@claude` authenticates via `CLAUDE_CODE_OAUTH_TOKEN` (subscription) or an API key, with `--max-turns` and job timeouts.
- Guardrails: agents never merge; `main` requires green CI; `CODEOWNERS` covers `sim/`, the physics adapter, and schemas.

## 9. Repo

`~/workspace/dungeon-crawler` (placeholder name), public on GitHub, MIT.

## 10. Layout

```
src/{sim,game,render,ui,input,audio,debug}/  main.ts
data/  assets/  tests/  docs/{adr,GLOSSARY.md}
```

## 11. Deferred / open after first playable

Roguelite meta-progression, audio (Howler), gamepad, boss behavior trees, real title.
