$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$composeBaseFile = Join-Path $root "docker-compose.production.yml"
$composeOverrideFile = Join-Path $root "docker-compose.prod.yml"
$envFile = if ($args.Count -gt 0) { $args[0] } else { Join-Path $root ".env" }

if (!(Test-Path $composeBaseFile)) {
  throw "[deploy-prod] missing compose file: $composeBaseFile"
}
if (!(Test-Path $composeOverrideFile)) {
  throw "[deploy-prod] missing compose override file: $composeOverrideFile"
}
if (!(Test-Path $envFile)) {
  throw "[deploy-prod] missing env file: $envFile`nCopy .env.production.example to .env and fill required values."
}
if (!(Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "[deploy-prod] docker is not installed"
}

docker info | Out-Null

$composeMode = "docker-compose-plugin"
try {
  docker compose version | Out-Null
}
catch {
  if (Get-Command "docker-compose" -ErrorAction SilentlyContinue) {
    $composeMode = "docker-compose-legacy"
  }
  else {
    throw "[deploy-prod] Docker Compose is missing (neither 'docker compose' nor 'docker-compose' found)."
  }
}

function Invoke-Compose {
  param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Args
  )
  if ($composeMode -eq "docker-compose-legacy") {
    & docker-compose @Args
  }
  else {
    & docker compose @Args
  }
}

function Get-EnvValue([string]$Path, [string]$Key) {
  $line = Get-Content $Path |
    Where-Object { $_ -and ($_ -notmatch '^\s*#') } |
    Where-Object { $_ -match '^\s*[^=]+=' } |
    Where-Object { ($_ -split '=', 2)[0].Trim() -eq $Key } |
    Select-Object -First 1

  if (-not $line) {
    return ""
  }

  return (($line -split '=', 2)[1]).Trim()
}

function Require-Env([string]$Path, [string]$Key) {
  $value = Get-EnvValue -Path $Path -Key $Key
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "[deploy-prod] required env '$Key' is missing or empty in $Path"
  }
}

$required = @(
  "PUBLIC_HOST",
  "ACME_EMAIL",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "DATABASE_URL",
  "AUTH_TOKEN_PEPPER",
  "SECURITY_ENCRYPTION_KEY",
  "TRANSPORT_PRIMARY_WS_ENDPOINT"
)
foreach ($key in $required) {
  Require-Env -Path $envFile -Key $key
}

$composeArgs = @("-f", $composeBaseFile, "-f", $composeOverrideFile, "--env-file", $envFile)

Write-Host "[deploy-prod] starting stack with $envFile"
Invoke-Compose @composeArgs up -d --build --remove-orphans

Write-Host "[deploy-prod] container status"
Invoke-Compose @composeArgs ps

$publicHost = Get-EnvValue -Path $envFile -Key "PUBLIC_HOST"
$readyPath = Get-EnvValue -Path $envFile -Key "READY_PATH"
if ([string]::IsNullOrWhiteSpace($readyPath)) {
  $readyPath = "/ready"
}

$readyUrl = "http://127.0.0.1$readyPath"
Write-Host "[deploy-prod] waiting for readiness at $readyUrl (Host: $publicHost)"

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $null = Invoke-WebRequest -Uri $readyUrl -Headers @{ Host = $publicHost } -UseBasicParsing -TimeoutSec 5
    $ready = $true
    break
  }
  catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $ready) {
  throw "[deploy-prod] readiness check failed. Inspect logs with: docker compose -f $composeBaseFile -f $composeOverrideFile --env-file $envFile logs --tail=100"
}

Write-Host "[deploy-prod] readiness check passed"
Write-Host "[deploy-prod] deployment finished successfully"
