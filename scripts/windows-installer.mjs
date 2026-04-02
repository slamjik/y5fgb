#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const rootDir = process.cwd();
const tauriDir = path.join(rootDir, "apps", "client-desktop", "src-tauri");
const tauriConfigPath = path.join(tauriDir, "tauri.conf.json");
const nsisBundleDir = path.join(tauriDir, "target", "release", "bundle", "nsis");
const artifactsDir = path.join(rootDir, "artifacts", "windows");

const command = process.argv[2] ?? "build";

main();

function main() {
  switch (command) {
    case "build":
      runBuildFlow();
      break;
    case "summary":
      printSummary();
      break;
    case "clean":
      cleanArtifacts();
      break;
    default:
      console.error(`[windows-installer] unknown command: ${command}`);
      console.error("Usage: node ./scripts/windows-installer.mjs [build|summary|clean]");
      process.exit(1);
  }
}

function runBuildFlow() {
  runNpm(["run", "test:release:rc"]);
  runNpm(["run", "build:desktop:windows"]);

  const installer = resolveLatestNsisInstaller();
  const tauriConfig = readJson(tauriConfigPath);
  const productName = typeof tauriConfig.productName === "string" ? tauriConfig.productName : "SecureMessenger";
  const version = typeof tauriConfig.version === "string" ? tauriConfig.version : "0.0.0";
  const architecture = detectArchitecture(installer.fileName);
  const normalizedProductName = normalizeProductName(productName);
  const canonicalName = `${normalizedProductName}_${version}_${architecture}_Setup.exe`;

  mkdirSync(artifactsDir, { recursive: true });
  const canonicalPath = path.join(artifactsDir, canonicalName);
  copyFileSync(installer.fullPath, canonicalPath);

  console.log(`[windows-installer] raw installer: ${installer.fullPath}`);
  console.log(`[windows-installer] canonical installer: ${canonicalPath}`);
  console.log("[windows-installer] done");
}

function printSummary() {
  const output = {
    rawBundleDir: nsisBundleDir,
    rawInstallers: collectNsisInstallers().map((item) => item.fullPath),
    canonicalArtifactsDir: artifactsDir,
    canonicalArtifacts: listCanonicalArtifacts(),
  };

  console.log("[windows-installer] artifact summary");
  console.log(JSON.stringify(output, null, 2));
}

function cleanArtifacts() {
  if (existsSync(nsisBundleDir)) {
    rmSync(nsisBundleDir, { recursive: true, force: true });
    console.log(`[windows-installer] removed ${nsisBundleDir}`);
  }

  if (existsSync(artifactsDir)) {
    rmSync(artifactsDir, { recursive: true, force: true });
    console.log(`[windows-installer] removed ${artifactsDir}`);
  }

  console.log("[windows-installer] clean completed");
}

function runNpm(args) {
  const result =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `npm ${args.map(quoteCmdArg).join(" ")}`], {
          stdio: "inherit",
          cwd: rootDir,
          env: process.env,
        })
      : spawnSync("npm", args, {
          stdio: "inherit",
          cwd: rootDir,
          env: process.env,
        });

  if (result.error) {
    console.error(`[windows-installer] failed to run npm ${args.join(" ")}`);
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function quoteCmdArg(value) {
  if (/^[a-zA-Z0-9._:/-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '\\"')}"`;
}

function resolveLatestNsisInstaller() {
  const installers = collectNsisInstallers();
  if (installers.length === 0) {
    throw new Error(`[windows-installer] no NSIS installers found in ${nsisBundleDir}`);
  }

  installers.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return installers[0];
}

function collectNsisInstallers() {
  if (!existsSync(nsisBundleDir)) {
    return [];
  }

  const entries = readdirSync(nsisBundleDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((fileName) => fileName.toLowerCase().endsWith(".exe") && fileName.toLowerCase().includes("setup"));

  return entries.map((fileName) => {
    const fullPath = path.join(nsisBundleDir, fileName);
    const stat = statSync(fullPath);
    return {
      fileName,
      fullPath,
      mtimeMs: stat.mtimeMs,
    };
  });
}

function listCanonicalArtifacts() {
  if (!existsSync(artifactsDir)) {
    return [];
  }

  return readdirSync(artifactsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(artifactsDir, entry.name));
}

function readJson(filePath) {
  // Remove UTF BOM if present.
  const content = readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(content);
}

function detectArchitecture(fileName) {
  const lowered = fileName.toLowerCase();
  if (lowered.includes("arm64")) {
    return "arm64";
  }
  if (lowered.includes("x86_64") || lowered.includes("x64")) {
    return "x64";
  }
  if (lowered.includes("x86")) {
    return "x86";
  }
  return process.arch === "x64" ? "x64" : process.arch;
}

function normalizeProductName(value) {
  const compact = value.replace(/[^a-zA-Z0-9]+/g, "").trim();
  return compact.length > 0 ? compact : "SecureMessenger";
}
