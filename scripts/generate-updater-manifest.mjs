#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const args = parseArgs(process.argv.slice(2));

const version = required(args.version, "--version");
const url = required(args.url, "--url");
const signatureFile = required(args["signature-file"], "--signature-file");
const output = required(args.output, "--output");
const target = args.target || "windows-x86_64";
const notes = args.notes || `Release ${version}`;
const pubDate = args["pub-date"] || new Date().toISOString();

const signature = readFileSync(signatureFile, "utf8").trim();
if (!signature) {
  throw new Error(`Signature file is empty: ${signatureFile}`);
}

const manifest = {
  version,
  notes,
  pub_date: pubDate,
  platforms: {
    [target]: {
      url,
      signature,
    },
  },
};

const outputPath = path.resolve(output);
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`[updater-manifest] generated ${outputPath}`);

function parseArgs(input) {
  const result = {};
  for (let index = 0; index < input.length; index += 1) {
    const token = input[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = input[index + 1];
    if (!value || value.startsWith("--")) {
      result[key] = "true";
    } else {
      result[key] = value;
      index += 1;
    }
  }
  return result;
}

function required(value, flag) {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`Missing required argument ${flag}`);
}
