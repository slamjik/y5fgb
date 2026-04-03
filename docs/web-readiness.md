# Web Readiness (Product Foundation)

## Implemented now
- `apps/client-web` is no longer a placeholder. It is a working web product foundation shell with:
  - server connect/bootstrap flow
  - auth + 2FA + session restore boundaries
  - authenticated app shell with product navigation
  - messaging foundation page (real conversations/history integration)
  - social foundation pages (people/groups/profile)
  - security and settings pages wired to live API where available
- shared web-safe layers stay in:
  - `packages/client-core`
  - `packages/platform-adapters`
- browser lifecycle remains aligned with relay contracts:
  - `/api/v1/config`
  - `/api/v1/auth/web/*`
  - `/api/v1/conversations*`
  - `/api/v1/devices`
  - `/api/v1/security-events`

## Architecture boundaries kept
- Browser session is a `session_class=browser`, not a trusted desktop device.
- Access token remains memory-first in web runtime.
- Shared packages do not import Tauri runtime.
- Web app does not import desktop app modules.

## Intentionally deferred
- Full browser crypto parity for message encryption/decryption compose flow.
- Final product UX polish and complete social graph features.
- Advanced multi-tab transport leader election.
