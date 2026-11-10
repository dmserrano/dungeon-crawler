#!/usr/bin/env bash
# Single install entrypoint shared by CI, cloud agents (copilot-setup-steps) and humans.
set -euo pipefail
cd "$(dirname "$0")/.."
corepack enable
pnpm install --frozen-lockfile
