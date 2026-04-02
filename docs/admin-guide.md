# Admin Guide

## Deploy
1. `cp .env.production.example .env`
2. Fill required secrets/host values.
3. Run:
   - Linux/macOS: `./scripts/deploy-prod.sh`
   - PowerShell: `./scripts/deploy-prod.ps1`

Migration model is single-flow: `relay-server` applies migrations on startup (`RUN_MIGRATIONS_ON_START=true`).

## Update
1. Pull latest code.
2. Redeploy with orphan cleanup:
   - `docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env up -d --build --remove-orphans`
3. Verify `/health` and `/ready`.

## Operational Checks
- Container state: `docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env ps`
- Logs: `docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env logs --tail=200`
- Proxy TLS route: `https://<PUBLIC_HOST>/health`
- WS route: `wss://<PUBLIC_HOST>/ws`
- Sync poll route: `/api/v1/sync/poll`

## Backup
- PostgreSQL dump + attachments archive.
- Restore steps: `docs/production-runbook.md`.
