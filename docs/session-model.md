# Session Model

## Session classes
- `device`: trusted desktop/device session
- `browser`: browser web session

Persisted session fields:
- `client_platform`
- `session_class`
- `persistent`

## Browser model
- Browser uses `session_class=browser`.
- It does not inherit trusted-device semantics.
- Default session mode is `ephemeral`.
- Optional remembered mode persists refresh token in browser state store.

## Web auth lifecycle
1. `GET /api/v1/config`
2. `POST /api/v1/auth/web/login`
3. optional `POST /api/v1/auth/web/2fa/verify`
4. `POST /api/v1/auth/web/refresh` (restore path)
5. `GET /api/v1/auth/web/session`
6. `POST /api/v1/auth/web/logout` / `POST /api/v1/auth/web/logout-all`

## Security invariants
- Access token is kept in memory vault.
- Refresh token persistence is policy-driven (`ephemeral` or `remembered`).
- Reuse detection and logout-all stay server-authoritative.
- Browser logout/session invalidation is propagated to other tabs through broadcast channel.
