# Admin Guide

## Deploy
1. `cp .env.production.example .env`
2. Fill required secrets/host values.
3. Choose mode via `.env`:
   - IP mode: `PUBLIC_HOST=<ip>` or `TLS_ENABLED=false` (no Caddy/TLS, direct `:8080`)
   - Domain mode: `PUBLIC_HOST=<domain>` + `TLS_ENABLED=true` (+ `ACME_EMAIL`, Caddy/TLS)
4. Run:
   - Linux/macOS: `./scripts/deploy-prod.sh`
   - PowerShell: `./scripts/deploy-prod.ps1`

Migration model is single-flow: `relay-server` applies migrations on startup (`RUN_MIGRATIONS_ON_START=true`).

## Update
1. Pull latest code.
2. Redeploy with orphan cleanup:
   - Linux/macOS: `./scripts/deploy-prod.sh`
   - PowerShell: `./scripts/deploy-prod.ps1`
3. Verify `/health` and `/ready`.

## Operational Checks
- Container state:
  - Domain mode: `docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env ps`
  - IP mode: `docker compose -f docker-compose.production.yml -f docker-compose.ip.yml --env-file .env ps`
- Logs:
  - Domain mode: `docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env logs --tail=200`
  - IP mode: `docker compose -f docker-compose.production.yml -f docker-compose.ip.yml --env-file .env logs --tail=200`
- Health route (domain): `https://<PUBLIC_HOST>/health`
- Health route (ip): `http://<PUBLIC_HOST>:8080/health`
- WS route (domain): `wss://<PUBLIC_HOST>/ws`
- WS route (ip): `ws://<PUBLIC_HOST>:8080/ws`
- Sync poll route: `/api/v1/sync/poll`

## Backup
- PostgreSQL dump + attachments archive.
- Restore steps: `docs/production-runbook.md`.
