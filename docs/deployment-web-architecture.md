# Web Deployment Architecture

## Topology
Browser -> Reverse Proxy/TLS -> Static Web + Relay API/WS -> Relay -> PostgreSQL

## Routing contract
- Web app static assets: `/`
- Relay API: `/api/v1/*`
- WebSocket: `/ws`
- Health/readiness: `/health`, `/ready`
- Attachments: `/api/v1/attachments/*`

## Public bootstrap endpoint
`GET /api/v1/config`

Response now includes:
- `api_base`
- `ws_url`
- `api_prefix`
- `policy_hints` (auth/session hints)
- `transport_profile_hints`

## Reverse proxy notes
- Keep TLS at edge.
- Preserve `X-Forwarded-Proto` and `X-Forwarded-Host` only when trusted proxy mode is enabled (`WEB_TRUST_PROXY_HEADERS=true`).
- Ensure WS upgrade pass-through.

## Origin security
Use explicit `WEB_ALLOWED_ORIGINS` in production.
Disable localhost/null allowances in production unless intentionally needed.

## Self-hosted modes
1. Single-domain
- Example: `https://chat.example.com` serves web + API + WS.

2. Split-domain
- `https://app.example.com` (static web)
- `https://relay.example.com` (API/WS)
- Add app origin to `WEB_ALLOWED_ORIGINS`.
