# Frontend Layering

## Layer map
1. Apps
- `apps/client-desktop`: product desktop UI/runtime
- `apps/client-web`: technical browser foundation shell

2. Shared frontend core
- `packages/client-core`
- platform-agnostic contracts/utilities only

3. Platform adapters
- `packages/platform-adapters`
- runtime-specific adapters wired to shared contracts

4. Shared wire/domain contracts
- `packages/protocol`
- `packages/shared-types`

## Implemented package responsibilities

### client-core
- runtime descriptor (`runtime.ts`)
- platform capability model (`capabilities.ts`)
- bootstrap context types (`bootstrap-context.ts`)
- session policy contract (`session-policy.ts`)
- storage classes/cleanup policy (`storage-model.ts`)
- crypto facade boundary (`crypto-facade.ts`)
- transport lifecycle state machine contract (`transport-lifecycle.ts`)
- server bootstrap config parsing (`server-config.ts`)

### platform-adapters
- desktop/web adapter factories (`platform.ts`)
- memory secret vault (`memory-secret-vault.ts`)
- indexeddb state store (`indexeddb-state-store.ts`)
- multi-tab coordination (`multitab-coordination.ts`)

## Import discipline
- enforced by `scripts/check-boundaries.mjs`
- checks deny:
  - `@tauri-apps/*` in shared/web code
  - desktop app imports in `apps/client-web`
  - node builtins in web client source

Run:
```bash
npm run check:boundaries
```
