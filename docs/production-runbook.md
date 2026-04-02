# Production Deployment Runbook (v1)

## 1. Prerequisites

- Linux host with Docker Engine + Docker Compose plugin.
- Public DNS record for `PUBLIC_HOST` pointing to this host.
- Open inbound ports: `80/tcp`, `443/tcp`.
- Repository cloned locally.

## 2. First Deploy

1. Copy environment template:
   - `cp .env.production.example .env`
2. Fill required variables in `.env`:
   - `PUBLIC_HOST`, `ACME_EMAIL`
   - `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`
   - `AUTH_TOKEN_PEPPER`, `SECURITY_ENCRYPTION_KEY`
   - `TRANSPORT_PRIMARY_WS_ENDPOINT`
3. Start stack:
   - Linux/macOS: `./scripts/deploy-prod.sh`
   - Windows PowerShell: `./scripts/deploy-prod.ps1`

Equivalent direct command:

```bash
docker compose -f docker-compose.production.yml --env-file .env up -d --build
```

## 3. Runtime Topology

- `postgres`: internal only (no host port mapping).
- `relay-migrate`: one-shot migration container (`/app/migrate -mode up`).
- `relay-server`: internal only, health/readiness served on HTTP.
- `caddy`: edge entrypoint with automatic TLS + reverse proxy for API/WS.

External access is only via Caddy on `80/443`.

## 4. Health and Sanity Checks

Basic checks:

```bash
docker compose -f docker-compose.production.yml --env-file .env ps
curl -H "Host: ${PUBLIC_HOST}" http://127.0.0.1/health
curl -H "Host: ${PUBLIC_HOST}" http://127.0.0.1/ready
```

TLS and routing checks:

```bash
curl -I https://${PUBLIC_HOST}/health
curl -I https://${PUBLIC_HOST}/ready
```

WebSocket sanity example (`wscat`):

```bash
wscat -c "wss://${PUBLIC_HOST}/ws" -s "sm.auth.<ACCESS_TOKEN>" -s "sm.v1"
```

Long-poll sanity example:

```bash
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "https://${PUBLIC_HOST}/api/v1/sync/poll?cursor=0&timeoutSec=1&limit=1"
```

## 5. Update / Restart / Rollback Basics

Update to latest code:

```bash
git pull
docker compose -f docker-compose.production.yml --env-file .env up -d --build
```

Restart services:

```bash
docker compose -f docker-compose.production.yml --env-file .env restart
```

View logs:

```bash
docker compose -f docker-compose.production.yml --env-file .env logs --tail=200
```

## 6. Backup and Restore (Minimal)

### Backup

PostgreSQL dump:

```bash
docker compose -f docker-compose.production.yml --env-file .env exec -T postgres \
  sh -lc 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql
```

Attachments archive:

```bash
docker compose -f docker-compose.production.yml --env-file .env exec -T relay-server \
  sh -lc 'tar -czf - -C /app/data/attachments .' > attachments.tar.gz
```

### Restore

Stop stack first:

```bash
docker compose -f docker-compose.production.yml --env-file .env down
```

Restore DB:

```bash
docker compose -f docker-compose.production.yml --env-file .env up -d postgres
docker compose -f docker-compose.production.yml --env-file .env exec -T postgres \
  sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backup.sql
```

Restore attachments:

```bash
docker compose -f docker-compose.production.yml --env-file .env up -d relay-server
cat attachments.tar.gz | docker compose -f docker-compose.production.yml --env-file .env exec -T relay-server \
  sh -lc 'tar -xzf - -C /app/data/attachments'
```

Start full stack:

```bash
docker compose -f docker-compose.production.yml --env-file .env up -d --build
```

## 7. Network Resilience Notes

- Primary transport: WebSocket (`TRANSPORT_PRIMARY_WS_ENDPOINT`).
- Fallback path: long-poll endpoints via `TRANSPORT_ALTERNATE_ENDPOINTS`.
- WS query-token fallback should stay disabled in production:
  - `TRANSPORT_WS_QUERY_TOKEN_FALLBACK=false`
- Client can define manual endpoint overrides at build time:
  - `VITE_TRANSPORT_ENDPOINT_OVERRIDES`.

## 8. Known Deferred Items

- Object storage backend for attachments.
- Dynamic signed transport endpoint distribution.
- Multi-region/federated relay deployment.
