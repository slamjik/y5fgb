# Client Storage Model

## Storage classes (shared contract)
Defined in `packages/client-core/src/storage-model.ts`:
- `volatile_secrets`
- `session_tokens`
- `sync_state`
- `encrypted_cache`
- `attachment_meta`
- `preferences`
- `identity_state`

## Web implementation in foundation app
- Secret vault: memory (`createMemorySecretVault`)
- State store: IndexedDB (`createIndexedDbStateStore`)
- Multi-tab signaling: BroadcastChannel + storage-event fallback

## Current web persistence policy
- Access token: memory only
- Refresh token:
  - ephemeral mode -> memory only
  - remembered mode -> IndexedDB
- Server config: localStorage (non-secret bootstrap information)

## Cleanup semantics
On logout/account switch/session invalidation:
- clear in-memory secret vault
- clear persisted refresh token
- reset auth/runtime state

## Deliberately deferred
- encrypted browser message cache implementation
- attachment blob caching policy
- full multi-tab sync ownership protocol
