#!/bin/sh
set -eu

# Refresh workspace links that may be preserved by the node_modules volume.
pnpm install --filter backend... --frozen-lockfile --offline

exec pnpm --dir backend start:dev
