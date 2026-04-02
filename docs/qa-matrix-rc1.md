# QA Matrix (1.0.0-rc.1)

## Scope
- Auth/devices/2FA/recovery
- Messaging (direct/group)
- Attachments + disappearing messages
- Transport (WS + long-poll fallback)
- Plugins (sandbox/capabilities/crash isolation)

## Critical Flows
1. Register -> login -> session bootstrap -> logout.
2. Pending device -> approve/reject/recovery-complete.
3. 2FA enable/disable + step-up sensitive actions.
4. Direct chat send/receive/retry/reconnect/resync.
5. Group create/add-member/send/history.
6. Attachment upload/download + retry + checksum fail.
7. Disappearing TTL across restart/resync.
8. Transport endpoint switch WS->poll->WS.
9. Plugin discover/install/enable/disable/fail.

## Severity Policy
- `P0`: crash/data loss/security boundary break.
- `P1`: broken primary workflow, no viable workaround.
- `P2`: degraded UX/secondary flow instability.
- `P3`: cosmetic/low impact (defer after RC).

Only `P0/P1/P2` are in-fix scope for RC finalization.

## Automation Gate
1. `npm run test:server`
2. `npm run build:client`
3. `npm run test:plugins:unit`
4. `npm run test:release:rc`
5. Optional integration with running backend: `RUN_RELEASE_SMOKE=1 npm run test:release:rc`

