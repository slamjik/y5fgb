#!/usr/bin/env bash
set -euo pipefail

cd apps/relay-server
set -a
source .env.development
set +a

go run ./cmd/relay-server
