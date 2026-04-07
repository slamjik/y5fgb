# Production Deployment Runbook (Single-Flow Migrations)

## 1. Prerequisites

- Linux host with Docker Engine + Docker Compose (plugin or legacy binary).
- Public DNS record for `PUBLIC_HOST` if TLS mode is used.
- Open inbound ports:
  - TLS mode: `80/tcp`, `443/tcp`
  - IP mode (no Caddy): `80/tcp`, `8080/tcp`
- Repository cloned on host.

## 2. Startup Flow (authoritative)

The deployment uses **one migration strategy only**:

1. `postgres` starts.
2. `postgres` becomes healthy (`pg_isready`).
3. `relay-server` starts and runs migrations at startup (`RUN_MIGRATIONS_ON_START=true`).
4. If migrations succeed, relay serves HTTP/WS.
5. If migrations fail, `relay-server` exits with a clear startup error.

There is no `relay-migrate` service in production anymore.

## 3. First Deploy

```bash
cp .env.production.example .env
```

Fill required values in `.env`:
- `PUBLIC_HOST`
- `ACME_EMAIL` (required only in domain/TLS mode)
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`
- `AUTH_TOKEN_PEPPER`, `SECURITY_ENCRYPTION_KEY`
- `TRANSPORT_PRIMARY_WS_ENDPOINT`
- `WEB_ALLOWED_ORIGINS` (for browser/web origin allowlist)
- `WEB_ALLOW_TAURI_ORIGIN` (keep `true` while desktop app is used)
- `WEB_TRUST_PROXY_HEADERS` (`true` behind reverse proxy, `false` for direct exposure)
- `WEB_SESSION_DEFAULT_PERSISTENCE` (`ephemeral` recommended)
- `WEB_SESSION_ALLOW_REMEMBERED` (toggle remembered browser sessions)

Deploy:
- Linux/macOS: `./scripts/deploy-prod.sh`
- Windows PowerShell: `./scripts/deploy-prod.ps1`

Auto mode selection in deploy scripts:
- **IP mode**: `PUBLIC_HOST=<ip>` or `TLS_ENABLED=false` -> starts `postgres + relay-server + web-client` (without `caddy`).
- **Domain mode**: `PUBLIC_HOST=<domain>` with TLS enabled -> starts full stack with `caddy`.

Equivalent commands:

```bash
# Domain mode:
docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env up -d --build --remove-orphans

# IP mode:
docker compose -f docker-compose.production.yml -f docker-compose.ip.yml --env-file .env up -d --build --remove-orphans
```

## 4. Normal Post-Deploy State

Expected `docker compose ps` state:
- `postgres`: `healthy`
- `relay-server`: `healthy`
- `caddy`: `healthy` (TLS mode)

If `relay-server` is restarting or exited, check logs first (migration failure or config issue).

## 5. Post-Deploy Sanity Checks

### Containers

```bash
# Domain mode:
docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env ps

# IP mode:
docker compose -f docker-compose.production.yml -f docker-compose.ip.yml --env-file .env ps
```

### Logs

```bash
# Domain mode:
docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env logs --tail=200

# IP mode:
docker compose -f docker-compose.production.yml -f docker-compose.ip.yml --env-file .env logs --tail=200
```

### Health/readiness through local edge

```bash
curl -H "Host: ${PUBLIC_HOST}" http://127.0.0.1/health
curl -H "Host: ${PUBLIC_HOST}" http://127.0.0.1/ready
```

IP mode alternative:

```bash
curl http://${PUBLIC_HOST}:8080/health
curl http://${PUBLIC_HOST}:8080/ready
```

### Public checks (TLS mode)

```bash
curl -I https://${PUBLIC_HOST}/health
curl -I https://${PUBLIC_HOST}/ready
```

Public checks (IP mode):

```bash
curl -I http://${PUBLIC_HOST}:8080/health
curl -I http://${PUBLIC_HOST}:8080/ready
```

### WS/long-poll smoke

```bash
wscat -c "wss://${PUBLIC_HOST}/ws" -s "sm.auth.<ACCESS_TOKEN>" -s "sm.v1"
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  "https://${PUBLIC_HOST}/api/v1/sync/poll?cursor=0&timeoutSec=1&limit=1"
```

## 6. Update / Restart

Update and redeploy:

```bash
git pull
./scripts/deploy-prod.sh
```

Restart:

```bash
# Domain mode:
docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env restart

# IP mode:
docker compose -f docker-compose.production.yml -f docker-compose.ip.yml --env-file .env restart
```

## 7. Backup & Restore (minimal)

### Backup

```bash
COMPOSE_FILES="-f docker-compose.production.yml -f docker-compose.prod.yml"
# For IP mode use: COMPOSE_FILES="-f docker-compose.production.yml -f docker-compose.ip.yml"

docker compose $COMPOSE_FILES --env-file .env exec -T postgres \
  sh -lc 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql

docker compose $COMPOSE_FILES --env-file .env exec -T relay-server \
  sh -lc 'tar -czf - -C /app/data/attachments .' > attachments.tar.gz
```

### Restore

```bash
COMPOSE_FILES="-f docker-compose.production.yml -f docker-compose.prod.yml"
# For IP mode use: COMPOSE_FILES="-f docker-compose.production.yml -f docker-compose.ip.yml"

docker compose $COMPOSE_FILES --env-file .env down --remove-orphans
docker compose $COMPOSE_FILES --env-file .env up -d postgres
docker compose $COMPOSE_FILES --env-file .env exec -T postgres \
  sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backup.sql

docker compose $COMPOSE_FILES --env-file .env up -d relay-server
cat attachments.tar.gz | docker compose $COMPOSE_FILES --env-file .env exec -T relay-server \
  sh -lc 'tar -xzf - -C /app/data/attachments'

docker compose $COMPOSE_FILES --env-file .env up -d --build --remove-orphans
```

## 8. Deferred Scope

- Object storage for attachments.
- Dynamic signed transport endpoint distribution.
- Multi-region/federated relay deployment.
