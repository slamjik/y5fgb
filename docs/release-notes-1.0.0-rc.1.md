# Release Notes: 1.0.0-rc.1

## Highlights
- Finalized desktop release candidate UX with onboarding + settings hub.
- Added RU/EN localization with system-language detection and manual switch.
- Normalized design tokens and consistent component styling.
- Added release sanity scripts and QA matrix/checklist docs.
- Prepared reproducible desktop packaging targets:
  - Windows: NSIS
  - Linux: AppImage + DEB

## Security/Product Notes
- Plugin sandbox/capability boundaries remain enforced.
- No breaking wire-contract changes for auth/device/messaging APIs.
- Code signing is intentionally deferred from this RC.

