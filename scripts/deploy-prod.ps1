$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$composeBaseFile = Join-Path $root "docker-compose.production.yml"
$composeDomainOverrideFile = Join-Path $root "docker-compose.prod.yml"
$composeIpOverrideFile = Join-Path $root "docker-compose.ip.yml"
$envFile = if ($args.Count -gt 0) { $args[0] } else { Join-Path $root ".env" }

if (!(Test-Path $composeBaseFile)) {
  throw "[deploy-prod] missing compose file: $composeBaseFile"
}
if (!(Test-Path $composeDomainOverrideFile)) {
  throw "[deploy-prod] missing compose file: $composeDomainOverrideFile"
}
if (!(Test-Path $composeIpOverrideFile)) {
  throw "[deploy-prod] missing compose file: $composeIpOverrideFile"
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

function Get-PublishedContainersByPort([int]$Port) {
  $rows = & docker ps --filter "publish=$Port" --format "{{.Names}}"
  if (-not $rows) {
    return @()
  }
  return @($rows | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
}

function Ensure-PortAvailable([int]$Port) {
  $offenders = Get-PublishedContainersByPort -Port $Port
  if ($offenders.Count -gt 0) {
    $formatted = ($offenders | ForEach-Object { "  - $_" }) -join "`n"
    throw "[deploy-prod] port $Port is already occupied by container(s):`n$formatted`n[deploy-prod] stop these containers or choose another port, then run deploy again."
  }
}

$publicHost = Get-EnvValue -Path $envFile -Key "PUBLIC_HOST"
if ([string]::IsNullOrWhiteSpace($publicHost)) {
  throw "[deploy-prod] required env 'PUBLIC_HOST' is missing or empty in $envFile"
}

$tlsEnabled = Get-EnvValue -Path $envFile -Key "TLS_ENABLED"
$parsedIp = $null
$isIpMode = [System.Net.IPAddress]::TryParse($publicHost, [ref]$parsedIp)
if ($tlsEnabled -match '^(?i:false|0|no)$') {
  $isIpMode = $true
}
$mode = if ($isIpMode) { "ip" } else { "domain" }

$required = @(
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
  "DATABASE_URL",
  "AUTH_TOKEN_PEPPER",
  "SECURITY_ENCRYPTION_KEY",
  "TRANSPORT_PRIMARY_WS_ENDPOINT"
)
if ($mode -eq "domain") {
  $required += "ACME_EMAIL"
}
foreach ($key in $required) {
  Require-Env -Path $envFile -Key $key
}

$webAllowedOrigins = Get-EnvValue -Path $envFile -Key "WEB_ALLOWED_ORIGINS"
if ($mode -eq "domain") {
  if ([string]::IsNullOrWhiteSpace($webAllowedOrigins)) {
    $webAllowedOrigins = "https://$publicHost"
  }
  $env:RELAY_PUBLISH_PORT = "8080"
  $env:WEB_PUBLISH_PORT = "8081"
  $composeOverride = $composeDomainOverrideFile
}
else {
  if ([string]::IsNullOrWhiteSpace($webAllowedOrigins)) {
    $webAllowedOrigins = "http://$publicHost"
  }
  $relayPublishAddress = Get-EnvValue -Path $envFile -Key "RELAY_PUBLISH_ADDRESS"
  $relayPublishPort = Get-EnvValue -Path $envFile -Key "RELAY_PUBLISH_PORT"
  $webPublishAddress = Get-EnvValue -Path $envFile -Key "WEB_PUBLISH_ADDRESS"
  $webPublishPort = Get-EnvValue -Path $envFile -Key "WEB_PUBLISH_PORT"

  $env:RELAY_PUBLISH_ADDRESS = if ([string]::IsNullOrWhiteSpace($relayPublishAddress)) { "0.0.0.0" } else { $relayPublishAddress }
  $env:RELAY_PUBLISH_PORT = if ([string]::IsNullOrWhiteSpace($relayPublishPort)) { "8080" } else { $relayPublishPort }
  $env:WEB_PUBLISH_ADDRESS = if ([string]::IsNullOrWhiteSpace($webPublishAddress)) { "0.0.0.0" } else { $webPublishAddress }
  $env:WEB_PUBLISH_PORT = if ([string]::IsNullOrWhiteSpace($webPublishPort)) { "80" } else { $webPublishPort }
  $composeOverride = $composeIpOverrideFile
}
$env:WEB_ALLOWED_ORIGINS = $webAllowedOrigins

$composeArgs = @("-f", $composeBaseFile, "-f", $composeOverride, "--env-file", $envFile)

Write-Host "[deploy-prod] cleaning previous compose state (down --remove-orphans)"
try {
  Invoke-Compose @composeArgs down --remove-orphans | Out-Null
}
catch {
  # best-effort cleanup
}

if ($mode -eq "domain") {
  Ensure-PortAvailable -Port 80
  Ensure-PortAvailable -Port 443
}
else {
  Ensure-PortAvailable -Port ([int]$env:WEB_PUBLISH_PORT)
  Ensure-PortAvailable -Port ([int]$env:RELAY_PUBLISH_PORT)
}

Write-Host "[deploy-prod] starting stack with $envFile (mode: $mode)"
Invoke-Compose @composeArgs up -d --build --remove-orphans

Write-Host "[deploy-prod] container status"
Invoke-Compose @composeArgs ps

$readyPath = Get-EnvValue -Path $envFile -Key "READY_PATH"
if ([string]::IsNullOrWhiteSpace($readyPath)) {
  $readyPath = "/ready"
}

$readyUrl = "http://127.0.0.1$readyPath"
if ($mode -eq "domain") {
  Write-Host "[deploy-prod] waiting for readiness at $readyUrl (Host: $publicHost)"
}
else {
  Write-Host "[deploy-prod] waiting for readiness at $readyUrl"
}

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    if ($mode -eq "domain") {
      $null = Invoke-WebRequest -Uri $readyUrl -Headers @{ Host = $publicHost } -UseBasicParsing -TimeoutSec 5
    }
    else {
      $null = Invoke-WebRequest -Uri $readyUrl -UseBasicParsing -TimeoutSec 5
    }
    $ready = $true
    break
  }
  catch {
    Start-Sleep -Seconds 2
  }
}

if (-not $ready) {
  throw "[deploy-prod] readiness check failed. Inspect logs with: docker compose -f $composeBaseFile -f $composeOverride --env-file $envFile logs --tail=100"
}

Write-Host "[deploy-prod] readiness check passed"

if ($mode -eq "domain") {
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1/" -Headers @{ Host = $publicHost } -UseBasicParsing -TimeoutSec 5 | Out-Null
    Write-Host "[deploy-prod] web ui check passed (host: $publicHost)"
  }
  catch {
    Write-Warning "[deploy-prod] warning: web ui check failed at http://127.0.0.1/ (host: $publicHost)"
  }
}
else {
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1/healthz" -UseBasicParsing -TimeoutSec 5 | Out-Null
    Write-Host "[deploy-prod] web ui check passed"
  }
  catch {
    Write-Warning "[deploy-prod] warning: web ui check failed at http://127.0.0.1/healthz"
  }
}

if ($mode -eq "domain") {
  $sitePublicUrl = "https://$publicHost"
  $apiPublicUrl = "https://$publicHost"
}
else {
  $sitePublicUrl = "http://$publicHost"
  $apiPublicUrl = "http://$publicHost:8080"
}
Write-Host "[deploy-prod] site: $sitePublicUrl"
Write-Host "[deploy-prod] api:  $apiPublicUrl"

Write-Host "[deploy-prod] deployment finished successfully"
