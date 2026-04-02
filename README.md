# Secure Messenger Monorepo

**RU:** Desktop-first защищённый мессенджер: толстый клиент (Tauri/React) + zero-trust relay на Go + PostgreSQL.  
**EN:** Desktop-first secure messenger: thick client (Tauri/React) + zero-trust Go relay + PostgreSQL.

## Описание проекта / Project Overview

### Русский
Проект разделён на два основных слоя:
- `apps/client-desktop` — desktop-клиент (UI, локальная криптография, устройство, плагины, локальное хранилище).
- `apps/relay-server` — relay/backend (auth, device trust, очереди доставки, sync, attachments metadata).

Сервер **не расшифровывает** содержимое сообщений: хранит и ретранслирует только зашифрованные envelope/metadata.

### English
The system is split into two main layers:
- `apps/client-desktop` — desktop client (UI, local crypto, device model, plugins, local storage).
- `apps/relay-server` — relay/backend (auth, device trust, delivery queues, sync, attachment metadata).

The server **does not decrypt** message content: it stores and relays encrypted envelopes/metadata only.

## Стек / Stack

- Client: Tauri + React + TypeScript
- Backend: Go
- DB: PostgreSQL

## Быстрый старт (локально) / Local Quick Start

### 1) Требования / Prerequisites
- Node.js 20+
- Go 1.22+
- Rust toolchain + cargo
- Docker + Docker Compose plugin

### 2) Установка зависимостей / Install dependencies
```bash
npm install
```

### 3) Запуск сервера + БД (dev) / Start server + DB (dev)
```bash
docker compose up --build
```
Поднимутся `postgres` и `relay-server` на `localhost:5432` и `localhost:8080`.

### 4) Запуск клиента / Start client
Вариант A (быстро для UI разработки, через Vite):
```bash
npm run dev:client
```

Вариант B (настоящий desktop shell Tauri):
```bash
npm run tauri:dev --workspace apps/client-desktop
```

## Установка сервера (production) / Server Installation (production)

```bash
cp .env.production.example .env
```
Заполните обязательные переменные в `.env`:
- `PUBLIC_HOST`, `ACME_EMAIL`
- `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`
- `AUTH_TOKEN_PEPPER`, `SECURITY_ENCRYPTION_KEY`
- `TRANSPORT_PRIMARY_WS_ENDPOINT`

Запуск:
```bash
docker compose -f docker-compose.production.yml --env-file .env up -d --build
```

Проверка:
```bash
curl -I https://<PUBLIC_HOST>/health
curl -I https://<PUBLIC_HOST>/ready
```

Подробно:
- [`docs/production-runbook.md`](docs/production-runbook.md)
- [`docs/admin-guide.md`](docs/admin-guide.md)

## Установка клиента (release) / Client Installation (release)

### Для разработчика / For developers
Сборка desktop-пакетов:
```bash
npm run build:desktop:windows   # NSIS (Windows)
npm run build:desktop:linux     # AppImage + DEB (Linux)
```

### Для пользователя / For end users
Берите готовые артефакты из GitHub Releases:
- Windows: NSIS installer
- Linux: AppImage / DEB

## Как клиент подключается к серверу? / How the client connects to the server

### Коротко / Short answer
1. Клиент делает HTTP(S) запросы к API (`/api/v1/...`) для auth/session/devices/messaging/sync.
2. Для realtime клиент открывает WebSocket на `/ws`.
3. Если WebSocket недоступен — клиент автоматически уходит в long-poll (`/api/v1/sync/poll`).

### Важно по конфигу / Important config
Основные client env-переменные:
- `VITE_API_BASE_URL` — база API (пример: `https://chat.example.com`)
- `VITE_API_PREFIX` — обычно `/api/v1`
- `VITE_WS_URL` — websocket endpoint (пример: `wss://chat.example.com/ws`)
- `VITE_TRANSPORT_ENDPOINT_OVERRIDES` — optional CSV fallback endpoints

Dev пример (`apps/client-desktop/.env.development`):
- `VITE_API_BASE_URL=http://localhost:8080`
- `VITE_WS_URL=ws://localhost:8080/ws`

Prod пример (`apps/client-desktop/.env.production`):
- `VITE_API_BASE_URL=https://relay.example.com`
- `VITE_WS_URL=wss://relay.example.com/ws`

### Как это работает в рантайме / Runtime behavior
- Access token используется для API и WS авторизации.
- WS — primary transport.
- Long-poll — fallback transport при проблемах сети/endpoint.
- После reconnect клиент делает resync по курсору, чтобы не терять сообщения.

## Полезные команды / Useful Commands

- `npm run dev:infra` — postgres + relay (dev)
- `npm run dev:infra:down` — остановка dev infra
- `npm run dev:server` — запуск relay локально
- `npm run dev:client` — запуск client (Vite)
- `npm run test:server` — Go tests
- `npm run test:plugins:unit` — plugin unit sanity
- `npm run test:smoke:v4` — smoke checks
- `npm run test:release:rc` — release sanity gate
- `npm run deploy:prod:sh` / `npm run deploy:prod:ps1` — production deploy helpers

## Документация / Documentation

- User guide (RU/EN): [`docs/user-guide.md`](docs/user-guide.md)
- Dev guide: [`docs/dev-guide.md`](docs/dev-guide.md)
- Security boundaries: [`docs/security-boundaries.md`](docs/security-boundaries.md)
- Threat model: [`docs/threat-model-v1.md`](docs/threat-model-v1.md)
- Desktop release runbook: [`docs/desktop-release-runbook.md`](docs/desktop-release-runbook.md)
- QA/release docs:
  - [`docs/qa-matrix-rc1.md`](docs/qa-matrix-rc1.md)
  - [`docs/release-checklist-1.0.0-rc.1.md`](docs/release-checklist-1.0.0-rc.1.md)
  - [`docs/release-notes-1.0.0-rc.1.md`](docs/release-notes-1.0.0-rc.1.md)

## Короткий текст для GitHub “About” / Suggested GitHub “About” text

**RU:** Защищённый desktop-first мессенджер: Tauri-клиент, zero-trust relay на Go, PostgreSQL, E2EE-ready архитектура с fallback transport.  
**EN:** Secure desktop-first messenger: Tauri client, zero-trust Go relay, PostgreSQL, E2EE-ready architecture with resilient fallback transport.
