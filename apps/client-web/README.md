# client-web

Web-first product foundation for Secure Messenger.

## What is implemented
- server connect/bootstrap flow
- browser auth (`/auth/web/*`) + 2FA hook
- session restore/logout/logout-all
- app shell with product sections:
  - Overview
  - Conversations
  - People
  - Groups
  - Profile
  - Security
  - Settings
- transport status integration (WS + long-poll fallback snapshot)
- conversation and security data integration from relay API

## Current intentional limitation
- browser message composer send path is disabled until browser crypto adapter reaches parity.

## Run
```bash
npm run dev:web
```

## Build and boundary checks
```bash
npm run build:web
npm run check:boundaries
```
