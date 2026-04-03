# Transport Lifecycle

Shared lifecycle model (`packages/client-core/src/transport-lifecycle.ts`):
- states:
  - `bootstrapping`
  - `unauthenticated`
  - `restoring_session`
  - `connecting`
  - `connected`
  - `degraded`
  - `offline`
  - `forbidden`

- events:
  - `config_loaded`
  - `auth_restored`
  - `token_refreshed`
  - `ws_connected`
  - `ws_disconnected`
  - `poll_fallback_entered`
  - `resync_completed`
  - `visibility_changed`
  - `online_changed`
  - `transport_leader_changed`

## Web foundation runtime behavior
Implemented in `apps/client-web/src/app/transport-controller.ts`:
- WebSocket primary using `sm.v1` + `sm.auth.<token>` subprotocol
- long-poll fallback via `/api/v1/sync/poll`
- attempts WS re-entry from fallback
- handles browser online/offline and visibility changes
- refresh/rebind access token when needed

## Failure policy
- 401/403 on realtime path -> session forbidden -> trigger local logout flow
- network failures -> degraded/offline, keep fallback loop

## Deferred
- full message queue orchestration and UX
- cross-tab transport leader election semantics
- advanced backoff profile tuning
