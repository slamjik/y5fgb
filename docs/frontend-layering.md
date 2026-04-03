# Frontend Layering

## Layer map
1. Apps
- `apps/client-web`: web-first product foundation UI/runtime
- `apps/client-desktop`: desktop runtime/product client

2. Shared frontend core
- `packages/client-core`: platform-agnostic contracts, policies, lifecycle and config parsing

3. Platform adapters
- `packages/platform-adapters`: browser/desktop storage + runtime adapters

4. Shared contracts
- `packages/protocol`
- `packages/shared-types`

## Web app structure (current)
- `src/app/bootstrap-context.tsx`: server bootstrap lifecycle
- `src/app/auth-context.tsx`: browser auth/session lifecycle
- `src/app/messaging-context.tsx`: conversation/history foundation state
- `src/app/transport-context.tsx`: realtime/fallback runtime snapshot
- `src/app/AppShell.tsx`: product shell + section routing/state
- `src/lib/authed-request.ts`: auth-aware API helper

## Import discipline
Enforced by `npm run check:boundaries`.

Rules:
- no `@tauri-apps/*` imports in shared/web paths
- no imports from `apps/client-desktop` inside web app
- no Node builtins in web source
