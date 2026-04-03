# Secure Messenger Monorepo

**RU:** Desktop-first защищённый мессенджер: толстый клиент (Tauri/React) + zero-trust relay на Go + PostgreSQL.  
**EN:** Desktop-first secure messenger: thick client (Tauri/React) + zero-trust Go relay + PostgreSQL.

## О проекте / Project Overview

### Русский
Репозиторий состоит из двух основных частей:
- `apps/client-desktop` — desktop-клиент (UI, локальная криптография, device trust, плагины, локальное хранилище).
- `apps/client-web` — web-клиент (архитектурный placeholder, финальный UI вне текущего этапа).
- `apps/relay-server` — relay/backend (auth, device trust, sync, delivery queue, metadata attachments).

Сервер **не расшифровывает** сообщения: хранит и ретранслирует только зашифрованные envelope и служебные метаданные.

### English
The system has two main layers:
- `apps/client-desktop` — desktop client (UI, local crypto, device trust, plugins, local storage).
- `apps/client-web` — web client (architecture placeholder, final UI is out of this stage scope).
- `apps/relay-server` — relay/backend (auth, device trust, sync, delivery queue, attachment metadata).

The server **does not decrypt** message content: it stores and relays encrypted envelopes plus transport metadata only.

## Stack
- Client: Tauri + React + TypeScript
- Backend: Go
- DB: PostgreSQL

## Быстрый запуск сервера (1 команда) / One-command Server Install

### Linux
```bash
git clone <repo>
cd project
./install.sh
```

### Windows PowerShell
```powershell
git clone <repo>
cd project
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Что делает установщик автоматически:
1. Проверяет Docker и Docker Compose.
2. Просит ввести домен или IP.
3. Сам генерирует `.env` и секреты.
4. Поднимает сервер через Docker Compose.
5. Проверяет `health` и `config` endpoint.
6. Показывает готовый адрес для подключения клиента.

Режимы:
- Ввод **домена** -> `https://<domain>` и `wss://<domain>/ws` (через Caddy + TLS).
- Ввод **IP** -> `http://<ip>:8080` и `ws://<ip>:8080/ws` (без TLS, без Caddy).

## Local Development

### Prerequisites
- Node.js 20+
- Go 1.22+
- Rust toolchain + cargo
- Docker + Docker Compose plugin

### Install dependencies
```bash
npm install
```

### Start dev infra (postgres + relay)
```bash
docker compose up --build
```

### Start client (Vite)
```bash
npm run dev:client
```

### Start Tauri shell
```bash
npm run tauri:dev --workspace apps/client-desktop
```

## Manual Production Deploy

```bash
cp .env.production.example .env
docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env up -d --build --remove-orphans
```

Миграции применяются на старте `relay-server` (`RUN_MIGRATIONS_ON_START=true`).  
Если миграции не применились, контейнер `relay-server` завершится с ошибкой и не будет висеть в полурабочем состоянии.

Если нужен edge TLS через Caddy, запускайте все сервисы.  
Если нужен только IP-режим, можно поднять без Caddy:
```bash
docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env up -d --build postgres relay-server
```

Для cleanup старых контейнеров после обновлений:
```bash
docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env up -d --build --remove-orphans
```

### Auto mode deploy (recommended)

Use one command and the script will auto-pick mode from `.env`:

- IP mode: if `PUBLIC_HOST` is an IP or `TLS_ENABLED=false` -> starts `postgres + relay-server` (no Caddy/TLS).
- Domain mode: if `PUBLIC_HOST` is a domain and TLS is enabled -> starts full stack with Caddy + ACME TLS.

Linux:
```bash
./scripts/deploy-prod.sh
```

Windows PowerShell:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-prod.ps1
```

Пост-деплой sanity checks:
```bash
docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env ps
docker compose -f docker-compose.production.yml -f docker-compose.prod.yml --env-file .env logs --tail=150
curl -H "Host: <PUBLIC_HOST>" http://127.0.0.1/health
curl -H "Host: <PUBLIC_HOST>" http://127.0.0.1/ready
```

## Как клиент подключается к серверу / Client Connection Flow

1. На первом запуске клиент открывает экран подключения сервера.
2. Пользователь вводит домен/IP.
3. Клиент запрашивает `GET /api/v1/config`.
4. Если endpoint недоступен (404), клиент использует fallback:
   - `api_base = https://<host>` (или `http://<ip>:8080` для IP-режима)
   - `ws_url = wss://<host>/ws` (или `ws://<ip>:8080/ws`)
   - `api_prefix = /api/v1`
5. Конфиг сохраняется локально и дальше используется в runtime.

## Desktop Auto-Updates (Tauri)

Клиент поддерживает официальный updater через GitHub Releases:
- ручная проверка/установка в `Settings -> Updates`;
- фоновая проверка при старте (с ненавязчивым баннером);
- подпись update-пакетов обязательна (по `pubkey` в `tauri.conf.json`).

CI workflow: [`.github/workflows/desktop-release.yml`](.github/workflows/desktop-release.yml)
- собирает Windows NSIS build;
- публикует `.exe`, `.sig`, `latest.json` в GitHub Release.

Подробно:
- [`docs/desktop-auto-update.md`](docs/desktop-auto-update.md)

## Useful Commands
- `npm run dev:infra` — start dev infra
- `npm run dev:infra:down` — stop dev infra
- `npm run dev:server` — run relay locally
- `npm run dev:client` — run client (Vite)
- `npm run dev:web` — run web foundation shell
- `npm run test:server` — Go tests
- `npm run check:boundaries` — cross-platform import boundary checks
- `npm run build:web-foundation` — run boundary checks and build web app
- `npm run test:plugins:unit` — plugin unit checks
- `npm run test:smoke:v4` — smoke checks
- `npm run build:desktop:windows:installer` — build Windows NSIS installer + canonical artifact copy
- `npm run build:desktop:windows:beta` — build beta Windows installer using `tauri.beta.conf.json`
- `npm run build:desktop:windows:artifacts` — show Windows installer artifact paths
- `npm run build:desktop:windows:clean` — clean Windows installer outputs
- `npm run release:manifest:generate` — generate updater `latest.json` from asset URL/signature
- `npm run deploy:prod:sh` / `npm run deploy:prod:ps1` — production deploy helpers

## Documentation
- [`docs/user-guide.md`](docs/user-guide.md)
- [`docs/dev-guide.md`](docs/dev-guide.md)
- [`docs/security-boundaries.md`](docs/security-boundaries.md)
- [`docs/threat-model-v1.md`](docs/threat-model-v1.md)
- [`docs/production-runbook.md`](docs/production-runbook.md)
- [`docs/admin-guide.md`](docs/admin-guide.md)
- [`docs/windows-installer-runbook.md`](docs/windows-installer-runbook.md)
- [`docs/desktop-auto-update.md`](docs/desktop-auto-update.md)
- [`docs/web-readiness.md`](docs/web-readiness.md)
- [`docs/frontend-layering.md`](docs/frontend-layering.md)
- [`docs/browser-security-model.md`](docs/browser-security-model.md)
- [`docs/deployment-web-architecture.md`](docs/deployment-web-architecture.md)
- [`docs/session-model.md`](docs/session-model.md)
- [`docs/client-storage-model.md`](docs/client-storage-model.md)
- [`docs/transport-lifecycle.md`](docs/transport-lifecycle.md)
