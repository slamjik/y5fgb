# Admin Guide

## Deploy
1. `cp .env.production.example .env`
2. Fill required secrets/host values.
3. `./scripts/deploy-prod.sh` (or PowerShell variant).

Detailed deployment: `docs/production-runbook.md`.

## Update
1. Pull changes.
2. `docker compose -f docker-compose.production.yml --env-file .env up -d --build`
3. Verify `/health` and `/ready`.

## Operational Checks
- Proxy TLS route: `https://<PUBLIC_HOST>/health`
- WS route: `wss://<PUBLIC_HOST>/ws`
- Sync poll route: `/api/v1/sync/poll`

## Backup
- PostgreSQL dump + attachments archive.
- Restore steps are documented in `docs/production-runbook.md`.

