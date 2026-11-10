# 0003: Agent-driven software factory

Status: accepted (2026-11-09)

## Context

Framework first, then features defined and iterated on over time, some implemented by cloud agents (Copilot coding agent, `@claude`).

## Decision

- Thin factory first: `AGENTS.md` canonical (`CLAUDE.md` points to it), CI gates, headless sim-test harness, issue/PR templates, ADRs, glossary.
- Pipeline: grilling -> PRD issue -> agent-ready slice issues -> TDD PR -> review -> human merge.
- Agents never merge. `main` requires green CI. Architecture boundaries (`sim/` isolation) are enforced mechanically in CI. `CODEOWNERS` on `sim/`, physics adapter, schemas.
- Acceptance by replay: each feature adds a recorded input log with state assertions.
- CI and cloud-agent setup share one install script.

## Consequences

Slices must be self-contained since cloud agents start cold. Determinism is a hard requirement of the sim, not a nice-to-have.
