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

is_ipv4() {
  local value="$1"
  if [[ ! "$value" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
    return 1
  fi

  local part
  IFS='.' read -r -a parts <<<"$value"
  for part in "${parts[@]}"; do
    if (( part < 0 || part > 255 )); then
      return 1
    fi
  done
  return 0
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

require_non_empty PUBLIC_HOST
public_host="$(read_env_value PUBLIC_HOST)"
tls_enabled="$(read_env_value TLS_ENABLED)"

mode="domain"
if is_ipv4 "$public_host"; then
  mode="ip"
fi
case "${tls_enabled,,}" in
  false|0|no)
    mode="ip"
    ;;
esac

required_vars=(
  POSTGRES_DB
  POSTGRES_USER
  POSTGRES_PASSWORD
  DATABASE_URL
  AUTH_TOKEN_PEPPER
  SECURITY_ENCRYPTION_KEY
  TRANSPORT_PRIMARY_WS_ENDPOINT
)
if [[ "$mode" == "domain" ]]; then
  required_vars+=(ACME_EMAIL)
fi

for key in "${required_vars[@]}"; do
  require_non_empty "$key"
done

if [[ "$mode" == "domain" ]]; then
  export WEB_ALLOWED_ORIGINS="${WEB_ALLOWED_ORIGINS:-$(read_env_value WEB_ALLOWED_ORIGINS)}"
  if [[ -z "$WEB_ALLOWED_ORIGINS" ]]; then
    export WEB_ALLOWED_ORIGINS="https://${public_host}"
  fi
  current_web_publish_address="$(read_env_value WEB_PUBLISH_ADDRESS)"
  current_web_publish_port="$(read_env_value WEB_PUBLISH_PORT)"
  if [[ "$current_web_publish_address" == "0.0.0.0" || "$current_web_publish_port" == "80" ]]; then
    echo "[deploy-prod] domain mode: overriding WEB_PUBLISH_* to loopback to avoid :80 conflict with caddy"
  fi
  export WEB_PUBLISH_ADDRESS="127.0.0.1"
  export WEB_PUBLISH_PORT="8081"
  export RELAY_PUBLISH_ADDRESS="127.0.0.1"
  export RELAY_PUBLISH_PORT="8080"
else
  export WEB_ALLOWED_ORIGINS="${WEB_ALLOWED_ORIGINS:-$(read_env_value WEB_ALLOWED_ORIGINS)}"
  if [[ -z "$WEB_ALLOWED_ORIGINS" ]]; then
    export WEB_ALLOWED_ORIGINS="http://${public_host}"
  fi
  export WEB_PUBLISH_ADDRESS="0.0.0.0"
  export WEB_PUBLISH_PORT="80"
  export RELAY_PUBLISH_ADDRESS="0.0.0.0"
  export RELAY_PUBLISH_PORT="8080"
fi

compose_cmd=("${COMPOSE_BIN[@]}" -f "$COMPOSE_BASE_FILE" -f "$COMPOSE_OVERRIDE_FILE" --env-file "$ENV_FILE")

echo "[deploy-prod] starting stack with $ENV_FILE (mode: $mode)"
if [[ "$mode" == "ip" ]]; then
  echo "[deploy-prod] IP mode detected: starting postgres + relay-server + web-client (without caddy)"
  "${compose_cmd[@]}" rm -sf caddy >/dev/null 2>&1 || true
  "${compose_cmd[@]}" up -d --build --remove-orphans postgres relay-server web-client
else
  echo "[deploy-prod] domain mode detected: starting full stack with caddy + web-client"
  "${compose_cmd[@]}" up -d --build --remove-orphans
fi

echo "[deploy-prod] container status"
"${compose_cmd[@]}" ps

ready_path="$(read_env_value READY_PATH)"
if [[ -z "$ready_path" ]]; then
  ready_path="/ready"
fi

check_url="http://127.0.0.1${ready_path}"
echo "[deploy-prod] waiting for readiness at $check_url"

ready_ok=0
for _ in {1..30}; do
  if [[ "$mode" == "domain" ]]; then
    curl_cmd=(curl -fsS -H "Host: $public_host" "$check_url")
  else
    curl_cmd=(curl -fsS "$check_url")
  fi

  if "${curl_cmd[@]}" >/dev/null 2>&1; then
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

web_check_url="http://127.0.0.1/"
if [[ "$mode" == "domain" ]]; then
  if curl -fsS -H "Host: $public_host" "$web_check_url" >/dev/null 2>&1; then
    echo "[deploy-prod] web ui check passed (host: $public_host)"
  else
    echo "[deploy-prod] warning: web ui check failed at $web_check_url (host: $public_host)" >&2
  fi
else
  if curl -fsS "http://127.0.0.1/healthz" >/dev/null 2>&1; then
    echo "[deploy-prod] web ui check passed"
  else
    echo "[deploy-prod] warning: web ui check failed at http://127.0.0.1/healthz" >&2
  fi
fi

if [[ "$mode" == "domain" ]]; then
  site_public_url="https://${public_host}"
  api_public_url="https://${public_host}"
else
  site_public_url="http://${public_host}"
  api_public_url="http://${public_host}:8080"
fi
echo "[deploy-prod] site: ${site_public_url}"
echo "[deploy-prod] api:  ${api_public_url}"

echo "[deploy-prod] deployment finished successfully"
