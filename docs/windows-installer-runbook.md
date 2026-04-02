# Windows Installer Runbook

## Scope
This runbook describes how to build and validate the Windows installer (`NSIS`) for Secure Messenger.

## Prerequisites
- Windows 10/11
- Node.js 20+
- Rust toolchain (`rustup` + MSVC target)
- Visual Studio Build Tools (Desktop development with C++)
- WebView2 runtime available on test machine (installer can bootstrap it)

## Build Commands
From repository root:

```powershell
npm install
npm run build:desktop:windows:clean
npm run build:desktop:windows:installer
```

## Artifact Locations
- Raw NSIS output:
  - `apps/client-desktop/src-tauri/target/release/bundle/nsis/*.exe`
- Canonical release copy:
  - `artifacts/windows/SecureMessenger_<version>_<arch>_Setup.exe`

Quick artifact summary:

```powershell
npm run build:desktop:windows:artifacts
```

## Installer/Uninstaller Behavior
- Installer target: NSIS
- Install mode: `both` (user can choose current user or per-machine)
- Start menu folder: `Secure Messenger`
- Desktop/start menu shortcuts: managed by default NSIS flow
- Uninstall entry: registered in Windows Apps & Features

### User Data Policy
- Uninstall removes installed binaries and shortcuts.
- User profile data is **kept by default** (messages cache, local settings, keyring references) to avoid destructive data loss on reinstall.
- Full user-data wipe is an explicit support action, not default uninstall behavior.

## First-run Verification Checklist
1. Run installer and complete setup wizard.
2. Verify desktop shortcut (if selected) and start menu shortcut.
3. Launch app from shortcut.
4. Verify first screen is clean (server connect/onboarding flow, no dev logs/no debug prompts).
5. Connect to server and verify login screen opens.
6. Uninstall from Apps & Features.
7. Reinstall and verify app starts predictably.

## Code Signing Readiness
Signing is not automated in this repo yet, but configuration is ready for the next step:
- Tauri Windows config already supports signing fields (`digestAlgorithm`, `certificateThumbprint`, `timestampUrl`, `signCommand`).
- Next release step is to inject signing values via CI secrets or secure local env and run signed build on Windows runner.

## Known Limitations (v1)
- No auto-updater platform in this stage.
- No Microsoft Store packaging in this stage.
- No EV certificate onboarding in this stage.
