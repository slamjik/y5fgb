#!/usr/bin/env node
import { execSync } from "node:child_process";

const steps = [
  { name: "server-tests", command: "npm run test:server" },
  { name: "client-build", command: "npm run build:client" },
  { name: "plugin-unit", command: "npm run test:plugins:unit" },
];

if (process.env.RUN_RELEASE_SMOKE === "1") {
  steps.push({ name: "smoke-v4", command: "npm run test:smoke:v4" });
}

for (const step of steps) {
  console.log(`[release-sanity] running ${step.name}`);
  try {
    execSync(step.command, { stdio: "inherit" });
  } catch {
    console.error(`[release-sanity] failed at ${step.name}`);
    process.exit(1);
  }
}

console.log("[release-sanity] rc checks passed");

