#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const checks = [
  {
    name: "shared-and-web-no-tauri",
    include: [
      "packages/client-core/src",
      "packages/platform-adapters/src",
      "packages/protocol/src",
      "packages/shared-types/src",
      "apps/client-web/src",
    ],
    pattern: /@tauri-apps\//,
    message: "Tauri import is forbidden outside desktop app",
  },
  {
    name: "web-no-desktop-import",
    include: ["apps/client-web/src"],
    pattern: /(apps\/client-desktop|@\/[a-zA-Z0-9/_-]+)/,
    message: "Web app must not import desktop paths or desktop alias",
  },
  {
    name: "web-no-node-builtins",
    include: ["apps/client-web/src"],
    pattern: /from\s+["']node:/,
    message: "Web app source must not import Node builtins",
  },
  {
    name: "shared-no-app-imports",
    include: ["packages/client-core/src", "packages/platform-adapters/src"],
    pattern: /from\s+["']\.\.\/\.\.\/apps\//,
    message: "Shared packages must not import app modules",
  },
];

const violations = [];
for (const check of checks) {
  for (const dir of check.include) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) {
      continue;
    }
    for (const file of listSourceFiles(abs)) {
      const content = fs.readFileSync(file, "utf8");
      if (check.pattern.test(content)) {
        violations.push({ check: check.name, message: check.message, file: path.relative(root, file) });
      }
    }
  }
}

if (violations.length > 0) {
  console.error("Boundary check failed:\n");
  for (const violation of violations) {
    console.error(`- [${violation.check}] ${violation.file}: ${violation.message}`);
  }
  process.exit(1);
}

console.log("Boundary check passed.");

function listSourceFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(next);
        continue;
      }
      if (/\.(ts|tsx|mts|cts|js|jsx)$/.test(entry.name)) {
        out.push(next);
      }
    }
  }
  return out;
}
