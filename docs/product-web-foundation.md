# Product Web Foundation

## Current scope
`apps/client-web` is a functional product foundation, not a static placeholder.

Implemented sections:
- Overview
- Conversations
- People
- Groups
- Profile
- Security
- Settings

## Boundaries and states
- Booting state
- Server connect state
- Login state
- 2FA verification state
- Session restoring state
- Authenticated product shell
- Degraded/offline transport banner

## Real data integration
- Conversations and message envelopes from relay API
- Devices and security events from relay API
- Session/account/runtime state from auth/bootstrap/transport contexts

## Known limitations (intentional)
- Browser composer send path is disabled until browser crypto adapter is enabled.
- Social graph is still foundation-level (no invitations/discovery workflows yet).
- UI focuses on architecture-correct states, not final visual polish.

## Next stage
- Enable browser crypto adapter and message compose/send.
- Expand social interactions (friend requests/invites/discovery).
- Product polish, accessibility pass, and deeper messaging ergonomics.
