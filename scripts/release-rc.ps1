$ErrorActionPreference = "Stop"

Write-Host "[release-rc] running release sanity checks"
npm run test:release:rc

Write-Host "[release-rc] building desktop artifacts for current platform"
npm run build:desktop:rc

Write-Host "[release-rc] done"

