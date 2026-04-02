# Threat Model v1

## Scope

This model covers the desktop client (Tauri + React), relay server (Go), PostgreSQL metadata storage, and local plugin runtime.

## Primary Assets

- account/session tokens
- account and device private key material (client-side only)
- encrypted message envelopes and encrypted attachments
- local encrypted message store key and decrypted local cache
- device trust state and security event history

## Trust Boundaries

- trusted core: auth/device/session, messaging runtime, crypto provider, secure storage integration
- untrusted extension boundary: plugins running in sandboxed iframes
- untrusted network boundary: all transport links and relay infrastructure

## Main Threats Addressed in v1

- token leakage via URL/query traces
- plugin escape into core auth/crypto/storage surfaces
- attachment path traversal and blob tampering
- refresh-token replay/reuse after theft
- accidental secret leakage via logs
- malformed payload abuse on auth/messaging endpoints

## Security Controls in Place

- WS auth primary through `Sec-WebSocket-Protocol` (`sm.auth.<token>`), query fallback policy-gated
- strict keyring-only handling for security-critical client keys
- capability-gated plugin bridge (`postMessage`) with per-instance runtime token binding
- path and size validation for plugin manifests/entrypoints and attachment storage paths
- refresh-token rotation with reuse detection and account-wide session revocation
- checksum verification for encrypted attachment download
- body limits, rate limits, and strict JSON decoding on API routes
- redaction rules on client/server logs for tokens/keys/secrets/ciphertext fields

## Assumptions

- host OS keyring is available and trusted for secure key persistence
- TLS termination is configured in production deployment
- clients are trusted to perform encryption/decryption correctly
- server remains zero-trust for plaintext content

## Known v1 Limitations

- no full double-ratchet protocol yet (versioned envelope only)
- no plugin signing/provenance verification yet
- no advanced anomaly scoring or geo/risk engine
- query-token WS fallback may still be enabled in development environments
- no anti-censorship transport modules beyond WS + long-poll fallback

## Out of Scope

- mobile threat model
- federation trust model
- marketplace/distribution trust chain for plugins
- research-grade anti-censorship network designs
