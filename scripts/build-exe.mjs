#!/usr/bin/env node
// Builds a standalone executable for the biometrics-peaks CLI using Node.js's
// built-in Single Executable Application (SEA) support — no Node.js
// installation required to run the result.
//
// Usage: node scripts/build-exe.mjs
// Output: build/biometrics-peaks(.exe)

import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { inject } from "postject";

const root = path.resolve(import.meta.dirname, "..");
const buildDir = path.join(root, "build");
const bundlePath = path.join(buildDir, "biometrics-peaks.cjs");
const configPath = path.join(buildDir, "sea-config.json");
const blobPath = path.join(buildDir, "sea-prep.blob");
const isWindows = process.platform === "win32";
const exePath = path.join(buildDir, isWindows ? "biometrics-peaks.exe" : "biometrics-peaks");

fs.mkdirSync(buildDir, { recursive: true });

console.log("1/5  Bundling CLI (esbuild) …");
await build({
  entryPoints: [path.join(root, "bin", "biometrics-peaks.mjs")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: bundlePath,
  logLevel: "warning",
});

console.log("2/5  Writing SEA config …");
fs.writeFileSync(
  configPath,
  JSON.stringify(
    {
      main: path.relative(buildDir, bundlePath),
      output: path.relative(buildDir, blobPath),
      disableExperimentalSEAWarning: true,
    },
    null,
    2
  )
);

console.log("3/5  Generating SEA blob …");
execFileSync(process.execPath, ["--experimental-sea-config", "sea-config.json"], {
  cwd: buildDir,
  stdio: "inherit",
});

console.log("4/5  Copying the Node runtime …");
fs.copyFileSync(process.execPath, exePath);
if (!isWindows) fs.chmodSync(exePath, 0o755);

console.log("5/5  Injecting the blob (postject) …");
await inject(exePath, "NODE_SEA_BLOB", fs.readFileSync(blobPath), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  machoSegmentName: process.platform === "darwin" ? "NODE_SEA" : undefined,
});

console.log(`\nDone → ${path.relative(root, exePath)}`);
console.log(`Try:  ${path.relative(root, exePath)} <folder-or-file...> [--out results.csv]`);
