#!/usr/bin/env node
import assert from "node:assert/strict";

const allowedCapabilities = new Set([
  "ui.render",
  "commands.register",
  "storage.plugin_local",
  "notifications.local",
  "messages.read_active_conversation_summary",
  "messages.read_visible_messages",
  "events.subscribe",
]);

const deniedCapabilities = [
  "network.outbound",
  "filesystem.read",
  "filesystem.write",
  "transport.control",
  "auth.session",
  "crypto.keys",
  "identity.material",
];

function validateManifest(manifest) {
  if (!manifest || typeof manifest !== "object") {
    return { ok: false, code: "plugin_manifest_invalid" };
  }
  if (manifest.apiVersion !== "v1") {
    return { ok: false, code: "plugin_manifest_invalid" };
  }
  if (typeof manifest.id !== "string" || !/^[a-z0-9._-]{3,64}$/.test(manifest.id)) {
    return { ok: false, code: "plugin_manifest_invalid" };
  }
  if (!Array.isArray(manifest.requestedPermissions)) {
    return { ok: false, code: "plugin_manifest_invalid" };
  }
  for (const permission of manifest.requestedPermissions) {
    if (!allowedCapabilities.has(permission)) {
      return { ok: false, code: "plugin_permission_denied" };
    }
  }
  return { ok: true };
}

const validManifest = {
  apiVersion: "v1",
  id: "demo.plugin.valid",
  name: "Valid Plugin",
  version: "1.0.0",
  entrypoint: "index.js",
  requestedPermissions: ["ui.render", "events.subscribe"],
  declaredHooks: ["transport.state.changed"],
  uiContributions: { panels: [{ id: "valid.panel", title: "Valid" }] },
};

const deniedManifest = {
  ...validManifest,
  id: "demo.plugin.denied",
  requestedPermissions: ["ui.render", "network.outbound"],
};

const invalidShapeManifest = {
  ...validManifest,
  id: "NO_UPPERCASE_ALLOWED",
};

assert.deepEqual(validateManifest(validManifest), { ok: true }, "valid manifest must pass");
assert.equal(validateManifest(deniedManifest).code, "plugin_permission_denied", "denied capability must fail");
assert.equal(validateManifest(invalidShapeManifest).code, "plugin_manifest_invalid", "invalid shape must fail");

for (const denied of deniedCapabilities) {
  assert.equal(allowedCapabilities.has(denied), false, `denied capability leaked into allowlist: ${denied}`);
}

console.log("[plugin-unit] checks passed");

