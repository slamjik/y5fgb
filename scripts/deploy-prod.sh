#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env}"
COMPOSE_BASE_FILE="$ROOT_DIR/docker-compose.production.yml"
COMPOSE_OVERRIDE_FILE="$ROOT_DIR/docker-compose.prod.yml"

if [[ ! -f "$COMPOSE_BASE_FILE" ]]; then
  echo "[deploy-prod] missing compose file: $COMPOSE_BASE_FILE" >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_OVERRIDE_FILE" ]]; then
  echo "[deploy-prod] missing compose override file: $COMPOSE_OVERRIDE_FILE" >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "[deploy-prod] missing env file: $ENV_FILE" >&2
  echo "Copy .env.production.example to .env and fill required values." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "[deploy-prod] docker is not installed" >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "[deploy-prod] curl is not installed (required for readiness probe)" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[deploy-prod] docker daemon is not running" >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_BIN=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_BIN=(docker-compose)
else
  echo "[deploy-prod] Docker Compose is missing (neither 'docker compose' nor 'docker-compose' found)." >&2
  exit 1
fi

read_env_value() {
  local key="$1"
  local value
  value="$(awk -F= -v target="$key" '
    /^[[:space:]]*#/ {next}
    /^[[:space:]]*$/ {next}
    {
      k=$1
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", k)
      if (k == target) {
        print substr($0, index($0, "=") + 1)
        exit
      }
    }
  ' "$ENV_FILE" | tr -d '\r')"
  echo "$value"
}

require_non_empty() {
  local key="$1"
  local value
  value="$(read_env_value "$key")"
  if [[ -z "$value" ]]; then
    echo "[deploy-prod] required env '$key' is missing or empty in $ENV_FILE" >&2
    exit 1
  fi
}

required_vars=(
  PUBLIC_HOST
  ACME_EMAIL
  POSTGRES_DB
  POSTGRES_USER
  POSTGRES_PASSWORD
  DATABASE_URL
  AUTH_TOKEN_PEPPER
  SECURITY_ENCRYPTION_KEY
  TRANSPORT_PRIMARY_WS_ENDPOINT
)

for key in "${required_vars[@]}"; do
  require_non_empty "$key"
done

compose_cmd=("${COMPOSE_BIN[@]}" -f "$COMPOSE_BASE_FILE" -f "$COMPOSE_OVERRIDE_FILE" --env-file "$ENV_FILE")

echo "[deploy-prod] starting stack with $ENV_FILE"
"${compose_cmd[@]}" up -d --build --remove-orphans

echo "[deploy-prod] container status"
"${compose_cmd[@]}" ps

public_host="$(read_env_value PUBLIC_HOST)"
ready_path="$(read_env_value READY_PATH)"
if [[ -z "$ready_path" ]]; then
  ready_path="/ready"
fi

check_url="http://127.0.0.1${ready_path}"
echo "[deploy-prod] waiting for readiness at $check_url (Host: $public_host)"

ready_ok=0
for _ in {1..30}; do
  if curl -fsS -H "Host: $public_host" "$check_url" >/dev/null 2>&1; then
    ready_ok=1
    break
  fi
  sleep 2
done

if [[ "$ready_ok" -eq 1 ]]; then
  echo "[deploy-prod] readiness check passed"
else
  echo "[deploy-prod] readiness check failed. Inspect logs:" >&2
  echo "${compose_cmd[*]} logs --tail=100" >&2
  exit 1
fi

echo "[deploy-prod] deployment finished successfully"
