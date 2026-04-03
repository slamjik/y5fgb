# client-web (foundation shell)

`apps/client-web` is now a real technical foundation app for browser platform work.

Implemented in this stage:
- server connect/bootstrap flow (`/api/v1/config` + fallback)
- browser auth session model (`/auth/web/*`)
- session restore flow with remembered/ephemeral modes
- 2FA challenge hook point for web login
- transport foundation: WebSocket primary + long-poll fallback
- multi-tab coordination (`BroadcastChannel` + storage-event fallback)
- strict shared-layer usage (`@project/client-core`, `@project/platform-adapters`)

Intentional limits in this stage:
- no final product UI/visual polish
- no full browser E2EE parity yet
- no full messaging screens/composer in web app

## Run

```bash
npm run dev:web
```

## Build

```bash
npm run build:web-foundation
```
