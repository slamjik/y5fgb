# Desktop Release Runbook (1.0.0-rc.1)

## Targets
- Windows: NSIS installer
- Linux: AppImage + DEB

## Preflight
1. `npm install`
2. `npm run test:release:rc`

## Build (Windows runner)
1. `npm run build:desktop:windows:clean`
2. `npm run build:desktop:windows:installer`
3. Artifacts:
   - Raw: `apps/client-desktop/src-tauri/target/release/bundle/nsis`
   - Canonical: `artifacts/windows/SecureMessenger_<version>_<arch>_Setup.exe`

## Build (Linux runner)
1. `npm run build:desktop:linux`
2. Artifacts:
   - `apps/client-desktop/src-tauri/target/release/bundle/appimage`
   - `apps/client-desktop/src-tauri/target/release/bundle/deb`

## Combined current-OS build
- `npm run build:desktop:rc`

## Signing
- Out of scope for this RC.
- Apply signing as external release step before public distribution.
- See `docs/windows-installer-runbook.md` for signing readiness notes.
