# Browser Security Model (Implemented v1 Foundation)

## Authentication model
- Model: Bearer token v1.
- Browser identity: `session_class=browser` (not trusted device).
- Desktop remains `session_class=device`.

## Web auth endpoints (additive)
- `POST /api/v1/auth/web/login`
- `POST /api/v1/auth/web/2fa/verify`
- `POST /api/v1/auth/web/refresh`
- `POST /api/v1/auth/web/logout`
- `POST /api/v1/auth/web/logout-all`
- `GET /api/v1/auth/web/session`

## Browser token/storage rules
- Access token: memory-only (secret vault).
- Refresh token:
  - default: ephemeral (memory-only)
  - optional remembered mode: persisted in IndexedDB
- No access token in localStorage/sessionStorage.

## CORS/WS origin policy
- One shared allowlist policy for HTTP and WS.
- Disallowed origins are rejected explicitly.
- `tauri://localhost` and localhost/null origins are config-driven flags.

## Session security behavior
- Refresh reuse detection and account-wide revocation remain active.
- Browser sessions do not inherit trusted-device semantics.
- Sensitive operations still rely on server-side step-up and trust checks.

## Current hard limits
- Browser crypto parity is not claimed.
- `CryptoFacade` can expose blocked/partial support; no fake fallback allowed.
