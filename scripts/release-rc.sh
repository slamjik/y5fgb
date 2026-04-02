#!/usr/bin/env bash
set -euo pipefail

echo "[release-rc] running release sanity checks"
npm run test:release:rc

echo "[release-rc] building desktop artifacts for current platform"
npm run build:desktop:rc

echo "[release-rc] done"

