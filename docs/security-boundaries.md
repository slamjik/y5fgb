# Security Boundaries (v1)

## Trusted core

Trusted core includes:

- `auth/session/device/trust` model
- messaging runtime and transport orchestration
- crypto provider and key material handling
- secure local storage/keyring bridge
- backend relay/auth/messaging services

Trusted core responsibilities:

- issue and validate auth/session tokens
- process device trust and approval flows
- encrypt/decrypt message artifacts on client side
- enforce transport and sync policies
- enforce plugin capability model

## Untrusted plugin boundary

Plugins are explicitly untrusted extension code.

Execution boundary:

- each plugin runs in its own sandboxed iframe (`allow-scripts`)
- no direct access to core stores/services
- no direct access to keyring, secure storage internals, or crypto private material

Communication boundary:

- only via `postMessage` bridge
- per-plugin runtime handshake token binds bridge messages to the active sandbox instance
- every bridge method is capability-checked
- plugin receives sanitized data projections only

## What plugins can access in v1

Only if granted in manifest and enable flow:

- UI panel contribution
- command registration
- plugin-local namespaced storage
- limited conversation summary and visible message projection
- safe event subscription (`conversation.changed`, `transport.state.changed`, `message.visible`, `command.executed`)
- local notices

## What plugins cannot access in v1

Denied by policy and not exposed by bridge:

- private keys / identity private material
- auth session tokens and refresh material
- transport internals control path
- unrestricted filesystem/network access
- decrypted attachment blobs via raw core APIs
- full runtime state snapshots

## Closed attack surfaces

- plugin path traversal blocked in local discovery (`canonicalization + root check`)
- manifest validation enforced before install/enable
- bridge request capability gating
- plugin crash quarantine (`failed` status, safe unload)
- no `dangerouslySetInnerHTML` path for plugin panel rendering

## Known v1 limitations

- capability grants are all-or-nothing (no per-capability toggle UI)
- plugin authenticity/signature verification is not implemented
- plugin marketplace/distribution trust model is out of scope
- advanced anti-censorship transport modules are out of scope

## Future extension points

- manifest signing and trust policy
- granular capability prompt UX
- stricter isolated runtime policy (remote code provenance checks)
- richer plugin events and presentation API
- future stronger E2EE session layer without bridge/API rewrites
