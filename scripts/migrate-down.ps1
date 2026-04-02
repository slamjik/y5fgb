$ErrorActionPreference = "Stop"
Set-Location apps/relay-server
Get-Content .env.development | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  $pair = $_ -split '=', 2
  if ($pair.Length -eq 2) {
    Set-Item -Path "Env:$($pair[0])" -Value $pair[1]
  }
}

go run ./cmd/migrate -mode down
