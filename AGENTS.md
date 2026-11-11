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
pnpm bench           # headless sim benchmark (ms/tick); --json <file> saves results. Warn-only in CI vs merge-base
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
- New or changed workflow steps must pin every action by full commit SHA with a trailing version comment (`uses: owner/repo@<40-char-sha> # v1.2.3`); never a mutable tag. Resolve the SHA from the upstream release tag.

## Performance budget

Sim budget: `step()` with 200 dynamic bodies must stay under **4 ms per tick** (a 60 Hz frame is 16.6 ms; the rest is for render and the browser). `pnpm bench` measures it. CI (`bench.yml`) compares a PR with its merge-base and warns on a regression over 25% (shared runners are noisy); it never fails. `SPEC.md` rule 8 is unchanged.

## Debugging and replays

- In the game: `F1` toggles the physics debug draw + stats; `F2` downloads the current session as a replay JSON (seed + run-length-encoded inputs + final hash). Format and verifier: `src/sim/replay.ts` (`parseReplay`, `runReplay`).
- **Bump `SIM_VERSION` in `src/sim/replay.ts` whenever sim behavior changes** (movement constants, physics settings, new systems, room layout), or old replays will diverge silently.
- Replay format v2 (`SIM_VERSION` 2): `InputFrame` is `up/down/left/right/attack/dash` plus `aim` (integer 0-255, 256 steps per turn, 0 = +x, clockwise on screen). Inputs are run-length encoded as `[mask, aim, count]` (mask bits up=1 down=2 left=4 right=8 attack=16 dash=32; a new run starts when mask or aim changes). `parseReplay` rejects v1 files with a "format changed" error; re-record them.
- Debug keys: `F1` overlay (collider outlines; orange = hitboxes: active attack sensor and enemy projectiles, cyan = hurtboxes: player, enemies, dummy; text shows HP, attack phase, `PAUSED`, `ROOM CLEARED`, `DEAD`), `F2` download replay JSON, `F3` bug report, `F4` pause/resume, `.` advance exactly one tick while paused. Paused time runs no ticks, so the recorder gets no frames and `F2` still exports a valid replay.
- The sim emits a `cleared` event (and sets `SimState.cleared`) once every enemy and the dummy are dead; `main.ts` logs it. Player death logs and stops the sim; there is no restart yet.
- **Combat acceptance replays:** `tests/replay.combat-room-clear.test.ts` runs `tests/fixtures/replay.combat-room-clear.json` (clears the room alive) and `tests/fixtures/replay.combat-player-death.json` (ends in player death). Every gameplay change must keep them passing or re-record them with `pnpm exec tsx scripts/record-combat-replays.ts <seed> <clear|die> <out.json>` (and update the hashes in the test), and bump `SIM_VERSION` when behavior changed.
- `src/debug/logger.ts` is a ring-buffer logger (no globals); pass it in rather than importing a singleton.
- `F3` / the "Report bug" button downloads the replay as `.txt` (GitHub may reject `.json` attachments; `pnpm replay` reads any extension) and opens a prefilled issue URL (`src/debug/bug-report.ts`, form `.github/ISSUE_TEMPLATE/bug-report.yml`). Uncaught errors and unhandled rejections are written to the logger by `src/debug/error-capture.ts`. If you change the form field ids, change the URL builder too.

## Bug triage agent

Flow: player files a `bug-report` issue with a replay attached -> a maintainer (write access) applies the label `triage-agent` -> `.github/workflows/bug-triage.yml` runs the Claude Code Action -> the agent downloads the replay, runs `pnpm replay --json`, and classifies it:

- **reproduced** (hash mismatch or crash): commits the replay under `tests/fixtures/` plus a failing test to branch `triage/<issue-number>`, files ONE `slice` issue (links the bug, branch, failing test, acceptance criteria) and comments on the bug.
- **not reproduced** (verifies cleanly) or **unusable** (malformed, wrong `simVersion`, missing attachment): only comments, asking for what is missing.

Human step: review the filed slice, then add `agent-ready` yourself. The agent never opens or merges PRs, never applies `agent-ready`, never pushes to `main`, never touches `src/`.

**Trust decision:** the workflow runs only when a maintainer applies the label, never automatically on issues opened by outsiders, and `allowed_non_write_users` must stay unset. Issue bodies, logs and replays are untrusted input to an agent holding a write token (prompt injection). Automatic triage of outside reports needs its own ADR.

## Agentic PR review (opt-in, advisory)

Review never runs automatically. To request one on a non-draft PR from this repo, a maintainer (write access) either applies the label `review` or comments `@claude review`. `.github/workflows/claude-review.yml` then runs the `code-review` plugin and posts inline comments. Forks, drafts and users without write access are ignored; a newer request on the same PR cancels the running one.

Review comments are **advisory**: the job is not a required check and never approves or requests changes. A recurring comment should become a lint rule, architecture test or `AGENTS.md` line. The plugin skips a PR it has already commented on, so to re-review after new commits, delete its earlier comments first. `claude.yml` ignores comments containing `@claude review`, so the two workflows never fire on the same comment. Usage is tracked on PRD #5 until decision 3 (review budget) is made.

One-time setup: `gh label create review --description "Request an AI code review (advisory, opt-in)" --color 5319e7`

## Telemetry

The game makes no network calls and sends no data automatically. Bug reports only open a GitHub URL in a new tab on the user's own click/keypress; the user submits the issue themselves. Keep it that way: no remote error services, analytics or auto-submission.

## Weekly retro

`.github/workflows/retro.yml` runs Mondays (and on manual dispatch: Actions > Retro > Run workflow). It reads merged PRs and their review comments, failed CI runs, closed issues and the open backlog since the last `retro` issue, then keeps ONE open issue labeled `retro` with proposals plus a short code health sweep of `src/`. It is advisory: it never opens PRs, pushes or edits code, and it only touches the retro issue. Treat it as untrusted-input-reading (PR comments feed the prompt), so keep its token read-only except `issues: write`.

To act on a proposal, a human opens a `slice` issue for it (goal, acceptance criteria, areas touched, required test), links the retro issue, and adds `agent-ready` after review. Each proposal names the mechanical check that would encode it (lint rule, architecture test, CI step or an `AGENTS.md` line); prefer landing that check over a one-off fix. Close the retro issue once handled so the next run starts a fresh one.

GitHub disables scheduled workflows after 60 days without repository activity. If the retro stops appearing, re-enable it under Actions > Retro > Enable workflow, or run `gh workflow enable retro.yml`.

## Layout

```
src/{sim,game,render,ui,input,audio,debug}/   main.ts
data/  assets/  tests/  docs/{adr,GLOSSARY.md}  scripts/
```

## Assets

CC0 only (Kenney 16x16 packs for v1). Record every asset in `CREDITS.md` with source and license.
