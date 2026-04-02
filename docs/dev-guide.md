# Developer Guide

## Project Map
- `apps/client-desktop` - Tauri desktop app + React UI.
- `apps/relay-server` - Go backend.
- `packages/protocol` - shared DTO contracts.
- `packages/shared-types` - shared IDs/types.
- `scripts` - dev, smoke, deploy helpers.

## Local Dev
1. `npm install`
2. `npm run dev:infra`
3. `npm run dev:client`

## Plugin Development
1. Put plugin into app-data plugins dir (`plugins/<plugin-id>/manifest.json`).
2. Open `Plugins` page and run discovery.
3. Install + enable plugin.
4. Verify permissions and panel/command behavior.

## Release Sanity
- `npm run test:release:rc`
- Optional with running backend: `RUN_RELEASE_SMOKE=1 npm run test:release:rc`

