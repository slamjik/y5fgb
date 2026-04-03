# Web Readiness (Foundation Closed)

## Stage outcome
The repository is now prepared for first-class browser client development without changing desktop architecture.

What is now implemented in code:
- shared platform capability contract (`packages/client-core/src/capabilities.ts`)
- shared bootstrap/session/storage/transport contracts in `client-core`
- platform adapters for desktop and web (`packages/platform-adapters/src/platform.ts`)
- browser foundation app (not placeholder anymore) in `apps/client-web`
- additive relay web-session auth API (`/api/v1/auth/web/*`)
- session classification persisted in DB (`client_platform`, `session_class`, `persistent`)
- strict CORS + WS origin parity policy
- public bootstrap config hints in `/api/v1/config`

## What remains intentionally deferred
- full browser messaging UX
- browser crypto parity for E2EE message operations
- advanced multi-tab leader election and full sync ownership model
- cookie/hybrid auth migration (if required later)

## Non-negotiable boundaries
- Browser session is not a trusted desktop device.
- Access token remains memory-only in web app.
- Shared packages must not import Tauri runtime.
- Web app must not import desktop app modules.
