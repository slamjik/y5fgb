# Release Checklist: 1.0.0-rc.1

## Build + Tests
- [ ] `npm run test:server`
- [ ] `npm run build:client`
- [ ] `npm run test:plugins:unit`
- [ ] `npm run test:release:rc`
- [ ] Optional smoke with running backend.

## Desktop Artifacts
- [ ] Windows NSIS build passed.
- [ ] Linux AppImage build passed.
- [ ] Linux DEB build passed.

## Manual QA
- [ ] Auth/device/2FA/recovery.
- [ ] Direct/group messaging.
- [ ] Attachment upload/download/retry.
- [ ] Disappearing message expiry.
- [ ] WS fallback long-poll and reconnect/resync.
- [ ] Plugin isolation and capability enforcement.
- [ ] Onboarding/settings/i18n RU/EN.

## Docs
- [ ] README updated.
- [ ] User/Admin/Dev guides updated.
- [ ] Runbook links valid.

