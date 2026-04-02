# Secure Messenger Monorepo

Desktop-first secure messenger with zero-trust relay architecture.

## Stack

- Client: Tauri + React + TypeScript
- Backend: Go
- DB: PostgreSQL

## Repo layout

- `apps/client-desktop` - desktop client
- `apps/relay-server` - relay/auth/messaging server
- `packages/protocol` - shared API/ws DTO contracts
- `packages/shared-types` - branded ID/value types
- `infra` - docker env and compose files
- `scripts` - local dev helpers

## Quick start

1. Install Node.js 20+, Go 1.22+, Rust toolchain, Docker.
2. Run `npm install` in repo root.
3. Start backend + postgres: `docker compose up --build`.
4. Start desktop client: `npm run dev:client`.

## Useful scripts

- `npm run dev:infra` - run postgres + relay
- `npm run dev:infra:down` - stop infra and remove volumes
- `npm run dev:server` - run relay locally
- `npm run dev:client` - run desktop client locally
- `npm run db:migrate:up` - apply migrations
- `npm run db:migrate:down` - rollback last migration
- `npm run test:server` - run Go tests
- `npm run test:plugins:unit` - run plugin policy/manifest unit checks
- `npm run test:smoke:v4` - run platform smoke checks (requires running backend)
- `npm run test:release:rc` - run RC sanity gate (server tests + client build + plugin checks)
- `npm run build:desktop:windows` - build Windows NSIS bundle
- `npm run build:desktop:linux` - build Linux AppImage + DEB bundles
- `npm run build:desktop:rc` - build desktop bundle for current OS
- `npm run release:rc:sh` - run RC sanity + desktop build (bash)
- `npm run release:rc:ps1` - run RC sanity + desktop build (PowerShell)
- `npm run deploy:prod:sh` - run production deploy helper script (bash)
- `npm run deploy:prod:ps1` - run production deploy helper script (PowerShell)

PowerShell/Bash wrappers are available under `scripts/`.

## Production Deployment (Single Host)

Production stack is defined in:

- `docker-compose.production.yml`
- `.env.production.example`
- `infra/caddy/Caddyfile`

Quick path:

1. `cp .env.production.example .env`
2. Fill required secrets and host values in `.env`.
3. `docker compose -f docker-compose.production.yml --env-file .env up -d --build`

Deployment helper scripts:

- `./scripts/deploy-prod.sh`
- `./scripts/deploy-prod.ps1`

What the stack starts:

- `postgres` (internal-only)
- `relay-migrate` one-shot migration job
- `relay-server` (internal-only)
- `caddy` reverse proxy with ACME TLS on `80/443`

Readiness and health:

- `GET /health`
- `GET /ready`

Detailed operations runbook: [`docs/production-runbook.md`](docs/production-runbook.md)
Admin operations quick guide: [`docs/admin-guide.md`](docs/admin-guide.md)

## Release Candidate v1 (Desktop)

Target version: `1.0.0-rc.1`.

Desktop artifacts:

- Windows: NSIS installer
- Linux: AppImage + DEB

Build commands:

1. `npm run test:release:rc`
2. `npm run build:desktop:windows` (on Windows runner)
3. `npm run build:desktop:linux` (on Linux runner)
4. Optional API integration smoke with running backend: `RUN_RELEASE_SMOKE=1 npm run test:release:rc`

Release docs:

- QA matrix: [`docs/qa-matrix-rc1.md`](docs/qa-matrix-rc1.md)
- Release checklist: [`docs/release-checklist-1.0.0-rc.1.md`](docs/release-checklist-1.0.0-rc.1.md)
- Release notes: [`docs/release-notes-1.0.0-rc.1.md`](docs/release-notes-1.0.0-rc.1.md)
- Bug triage template: [`docs/bug-triage-template.md`](docs/bug-triage-template.md)
- User guide (RU/EN): [`docs/user-guide.md`](docs/user-guide.md)
- Dev guide: [`docs/dev-guide.md`](docs/dev-guide.md)
- Desktop release runbook: [`docs/desktop-release-runbook.md`](docs/desktop-release-runbook.md)

## Platform core finalization (current stage)

What is stabilized:

- predictable message lifecycle in client: `draft -> encrypting -> queued -> sending -> sent/delivered/failed/expired`
- dedup by sender-device + client-message-id in runtime store
- durable outbox replay and retry classification (`retryable` vs `non-retryable`)
- WS primary transport with controlled fallback to long-poll and endpoint rotation
- cursor-based sync hardening and reduced duplicate render after reconnect/resync
- attachment checksum validation and storage-path hardening on server
- cleaner queue/transport/conversation UX states
- capability-based plugin runtime v1 with sandboxed iframe isolation
- plugin manager UI, local/bundled plugin discovery, enable/disable lifecycle
- focused backend hardening: security headers, body limits, rate limiting, stricter validation

What is intentionally not added in this stage:

- new transport modes beyond existing WS + long-poll
- calls/video/mobile/federation/marketplace runtime
- full ratchet redesign

## Plugin system v1

- Execution model: `sandboxed iframe` per plugin (`sandbox="allow-scripts"`).
- Bridge model: capability-checked `postMessage` API only.
- Discovery sources:
  - bundled demo plugins,
  - local plugins from `app_data/plugins/<plugin-id>/manifest.json`.
- Permission model: all-or-nothing grant on enable.

Allowed capabilities in v1:

- `ui.render`
- `commands.register`
- `storage.plugin_local`
- `notifications.local`
- `messages.read_active_conversation_summary`
- `messages.read_visible_messages`
- `events.subscribe`

Denied by default in v1:

- `network.outbound`
- `filesystem.read`
- `filesystem.write`
- `transport.control`
- `auth.session`
- `crypto.keys`
- `identity.material`

How to use:

1. Open `Plugins` in the sidebar.
2. Click `Discover Plugins`.
3. For discovered items: `Install` -> `Enable`.
4. Run plugin commands directly in Plugin Manager.
5. Open plugin panels from panel links.

Local plugin dev flow:

1. Place plugin under app data directory:
   - Windows example: `%APPDATA%/<app-id>/plugins/<plugin-id>/`
2. Add `manifest.json` with required fields:
   - `apiVersion`, `id`, `name`, `version`, `entrypoint`, `requestedPermissions`, `declaredHooks`, `uiContributions`.
3. Add entrypoint script file referenced by `entrypoint`.
4. Open Plugin Manager and click `Discover Plugins`.
5. Install + enable the plugin.

## Manual verification flows

### Auth/identity/device

1. Register account A from client #1.
2. Login account A from client #2 and confirm it lands in `pending` state.
3. Approve/reject from trusted device on client #1.
4. Enable optional 2FA and verify sensitive actions require step-up.
5. Rotate current device key from `Devices` and verify trust warning/security event update.
6. Trigger `Logout Everywhere` and confirm old sessions are revoked.

### Messaging core

1. Create direct conversation between two trusted accounts.
2. Send messages both ways and confirm server only handles encrypted envelope fields.
3. Restart one client, verify history/bootstrap restores and no duplicate inserts.
4. Disconnect WS endpoint (or stop server briefly), verify fallback to long-poll and queue replay after reconnect.
5. Send attachment, download on peer, verify retry path on transient failure.
6. Send messages with TTL and verify `expired` state is shown consistently after restart/resync.
7. Create group, add member (owner/admin), send group messages, verify membership enforcement.

### Plugin runtime

1. Open `Plugins` page and run discovery.
2. Enable `Transport Health Panel` and verify panel updates on reconnect/transport state change.
3. Enable `Conversation Summary` and verify active conversation/message counters update.
4. Enable `Local Actions`, run command, verify plugin-local counter increments and notice appears.
5. Verify denied capabilities are not available to plugins by default.
6. Disable plugin and verify its commands/panels are removed from runtime state.

### Smoke checks

1. Start backend and DB (`docker compose up --build` or equivalent local stack).
2. Run `npm run test:smoke:v4`.
3. Verify output ends with `[smoke] v4 checks passed` (includes key-rotation and logout-all sanity).

### Health checks

- `GET http://localhost:8080/health`
- `GET /api/v1/transport/endpoints` (authenticated)
- `GET /api/v1/sync/bootstrap` and `GET /api/v1/sync/poll` (authenticated)

## Security notes

- server stores only encrypted payloads + metadata for messaging
- private keys remain client-side
- logs must not contain plaintext messages, decrypted blobs, or raw secrets
- client secure material uses OS keyring bridge (strict path for messaging key material)
- plugin runtime is untrusted; trusted/untrusted boundaries are documented in [`docs/security-boundaries.md`](docs/security-boundaries.md)
- threat model assumptions and limitations are documented in [`docs/threat-model-v1.md`](docs/threat-model-v1.md)
