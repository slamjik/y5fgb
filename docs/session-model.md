# Session Model

## Session classes
- `device`: trusted desktop/device-bound session
- `browser`: web session class for browser clients

Stored in `sessions` table:
- `client_platform` (`desktop-tauri` | `web-browser`)
- `session_class` (`device` | `browser`)
- `persistent` (bool)

## Browser persistence policy
- default persistence from server config: `WEB_SESSION_DEFAULT_PERSISTENCE` (`ephemeral` or `remembered`)
- `WEB_SESSION_ALLOW_REMEMBERED` controls whether remembered mode is permitted

## Browser flow
1. Bootstrap config (`/api/v1/config`)
2. Login (`/auth/web/login`) or 2FA verify (`/auth/web/2fa/verify`)
3. Restore via `/auth/web/refresh` if remembered refresh token exists
4. Session introspection via `/auth/web/session`
5. Logout single/all via `/auth/web/logout`, `/auth/web/logout-all`

## Security invariants
- Browser sessions are not trusted devices.
- Access token must be short-lived and in-memory on web client.
- Refresh reuse detection revokes account sessions globally.
- Logout/logout-all must clear browser local session material.
