# Transport Lifecycle

## Canonical lifecycle model
Defined in `packages/client-core/src/transport-lifecycle.ts`.

States:
- `bootstrapping`
- `unauthenticated`
- `restoring_session`
- `connecting`
- `connected`
- `degraded`
- `offline`
- `forbidden`

Events:
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

## Web runtime behavior
Implemented in `apps/client-web/src/app/transport-controller.ts`.

- Primary: WebSocket (`sm.v1` + auth subprotocol)
- Fallback: long-poll `/api/v1/sync/poll`
- Browser signals: `online/offline`, `visibilitychange`
- Access-token refresh/rebind supported before reconnect attempts

## Product-level UX integration
- Transport snapshot is surfaced in topbar and settings.
- Degraded/offline state shows a warning banner in app shell.
- Reconnect action is available from topbar/settings.

## Deferred
- Advanced transport leader election across tabs
- richer queue/resync UX semantics in web messaging UI
