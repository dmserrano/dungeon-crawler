# AGENTS.md

Canonical guide for every agent and contributor (Claude Code, Copilot coding agent, `@claude`, humans). Read `SPEC.md` first; it is the frozen source of truth. Changes to decisions need an ADR in `docs/adr/`.

## Commands

```bash
./scripts/setup.sh   # install deps (same script CI and cloud agents use)
pnpm dev             # vite dev server
pnpm verify          # typecheck + lint + tests. Must pass before opening a PR
pnpm test            # vitest
pnpm test:coverage   # vitest + v8 coverage; src/sim/** must stay >= 80% lines (vite.config.ts)
pnpm replay <file>   # verify a replay JSON headless (tsx + real sim/Rapier); --json for machine output; exit 0 ok, 1 fail, 2 usage
pnpm knip            # dead code / unused deps (knip.json)
pnpm build && pnpm size  # gzip JS soft-budget warning on dist/ (BUDGET_KB in scripts/check-bundle-size.mjs; warns, never fails)
pnpm format          # biome check --write
```

## Architecture rules (enforced by CI where noted)

1. `src/sim/` is headless and deterministic: no Pixi, Preact, DOM, `window`, `document`, `Math.random()`, `Date.now()` or `performance.now()`, and no imports from `render/ ui/ input/ audio/ debug/ game/`. **Enforced by `tests/architecture.test.ts`.**
2. All gameplay randomness uses `src/sim/rng`. Same seed + same input log must give the same state hash (`src/sim/state/hash.ts`).
3. Physics is accessed only through the `PhysicsWorld` adapter (not yet written); never import Rapier outside it.
4. Content (enemies, items, rooms) is data validated by Zod. Prefer adding data over adding code. Schemas live in `data/schemas/`, JSON in `data/`, loaders in `src/sim/data/`.
4a. Entities live in the ECS behind `src/sim/ecs/world.ts`. **miniplex is imported only there**; everything else uses its create/remove/add/query functions. Systems are plain functions over queries, run in order input, movement, physics step, sync. Entity ids come from the counter on the ECS world.
5. Fixed 60 Hz sim step; render interpolates.
6. No generative AI or network calls at runtime.

## Workflow

- Backlog is GitHub Issues. Work in vertical slices. Each issue states goal, acceptance criteria, areas touched, and the required test or replay.
- TDD: write the failing test first. Every feature adds one replay (recorded input log + state assertions) as its acceptance test once the replay harness exists.
- One branch/worktree per issue, one PR per issue. Agents never merge; a human reviews and squash-merges. `main` requires green CI.
- Cloud agents start cold: if an issue lacks context you need, comment on it rather than guessing.
- Commit messages: short imperative subject. No co-author trailers.

## Debugging and replays

- In the game: `F1` toggles the physics debug draw + stats; `F2` downloads the current session as a replay JSON (seed + run-length-encoded inputs + final hash). Format and verifier: `src/sim/replay.ts` (`parseReplay`, `runReplay`).
- **Bump `SIM_VERSION` in `src/sim/replay.ts` whenever sim behavior changes** (movement constants, physics settings, new systems, room layout), or old replays will diverge silently.
- `src/debug/logger.ts` is a ring-buffer logger (no globals); pass it in rather than importing a singleton.
- `F3` / the "Report bug" button downloads the replay as `.txt` (GitHub may reject `.json` attachments; `pnpm replay` reads any extension) and opens a prefilled issue URL (`src/debug/bug-report.ts`, form `.github/ISSUE_TEMPLATE/bug-report.yml`). Uncaught errors and unhandled rejections are written to the logger by `src/debug/error-capture.ts`. If you change the form field ids, change the URL builder too.

## Telemetry

The game makes no network calls and sends no data automatically. Bug reports only open a GitHub URL in a new tab on the user's own click/keypress; the user submits the issue themselves. Keep it that way: no remote error services, analytics or auto-submission.

## Layout

```
src/{sim,game,render,ui,input,audio,debug}/   main.ts
data/  assets/  tests/  docs/{adr,GLOSSARY.md}  scripts/
```

## Assets

CC0 only (Kenney 16x16 packs for v1). Record every asset in `CREDITS.md` with source and license.
