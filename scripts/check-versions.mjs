#!/usr/bin/env node
/* global console, process */
// Enforces the release version-agreement invariant documented in docs/release.md.
//
// Every workspace package, both manifest.json copies, both versions.json copies,
// and the README install pins must name the same version. The root manifest and
// versions copies exist because the Obsidian directory portal reads them from the
// repository root, so they must stay byte-identical to the plugin originals.
//
// Workspace packages are discovered rather than hardcoded so adding or removing a
// package cannot silently drop it from this check.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const failures = [];

function fail(message) {
  failures.push(message);
}

function rel(absolutePath) {
  return path.relative(repoRoot, absolutePath);
}

function readText(absolutePath) {
  return fs.readFileSync(absolutePath, "utf8");
}

function readJson(absolutePath) {
  return JSON.parse(readText(absolutePath));
}

function discoverWorkspacePackages() {
  // Mirrors the `packages/*` and `apps/*` globs in pnpm-workspace.yaml.
  return ["packages", "apps"]
    .flatMap((workspaceDir) => {
      const absoluteDir = path.join(repoRoot, workspaceDir);
      if (!fs.existsSync(absoluteDir)) {
        return [];
      }
      return fs
        .readdirSync(absoluteDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(absoluteDir, entry.name, "package.json"));
    })
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .sort();
}

const rootPackagePath = path.join(repoRoot, "package.json");
const expected = readJson(rootPackagePath).version;

if (typeof expected !== "string" || !/^\d+\.\d+\.\d+$/.test(expected)) {
  console.error(`package.json version is not a bare semver string: ${JSON.stringify(expected)}`);
  process.exit(1);
}

// 1. Every workspace package agrees with the root version.
const workspacePackages = discoverWorkspacePackages();
if (workspacePackages.length === 0) {
  fail("no workspace packages discovered under packages/ or apps/");
}
for (const packagePath of workspacePackages) {
  const { version } = readJson(packagePath);
  if (version !== expected) {
    fail(`${rel(packagePath)} is ${version}, expected ${expected}`);
  }
}

// 2. The root Obsidian copies are byte-identical to the plugin originals.
const pluginDir = path.join(repoRoot, "apps", "obsidian-plugin");
for (const fileName of ["manifest.json", "versions.json"]) {
  const rootCopy = path.join(repoRoot, fileName);
  const pluginCopy = path.join(pluginDir, fileName);
  if (!fs.existsSync(rootCopy) || !fs.existsSync(pluginCopy)) {
    fail(`missing ${fileName}: expected both ${rel(rootCopy)} and ${rel(pluginCopy)}`);
    continue;
  }
  if (readText(rootCopy) !== readText(pluginCopy)) {
    fail(
      `${rel(rootCopy)} differs from ${rel(pluginCopy)} — copy the plugin file to the repo root`,
    );
  }
}

// 3. The plugin manifest names the release version.
const manifestPath = path.join(pluginDir, "manifest.json");
const manifest = readJson(manifestPath);
if (manifest.version !== expected) {
  fail(`${rel(manifestPath)} version is ${manifest.version}, expected ${expected}`);
}

// 4. versions.json maps the release version to the manifest's minAppVersion.
//    Obsidian reads this map to decide which plugin build an app version may install.
const versionsPath = path.join(pluginDir, "versions.json");
const versions = readJson(versionsPath);
if (!Object.hasOwn(versions, expected)) {
  fail(`${rel(versionsPath)} has no entry for ${expected}`);
} else if (versions[expected] !== manifest.minAppVersion) {
  fail(
    `${rel(versionsPath)} maps ${expected} to ${versions[expected]}, ` +
      `but manifest.json minAppVersion is ${manifest.minAppVersion}`,
  );
}

// 5. README install pins match the release version.
const readmePath = path.join(repoRoot, "README.md");
const pinPattern = /@gotsaeng\/(?:cli|core|mcp)@(\d+\.\d+\.\d+)/g;
const readme = readText(readmePath);
const stalePins = new Set(
  [...readme.matchAll(pinPattern)].map((match) => match[1]).filter((pin) => pin !== expected),
);
for (const pin of stalePins) {
  fail(`README.md pins @gotsaeng/*@${pin}, expected ${expected}`);
}

// 6. The public README still carries the product branding. This lived in the CLI
//    test suite, where a README copy edit failed an unrelated package; it belongs
//    with the other repo-level README invariants.
const REQUIRED_README_BRANDING = [
  "GotSaeng OS",
  "Reclaim your scattered life",
  "흩어진 생을 다시 손에 쥐다",
];
for (const phrase of REQUIRED_README_BRANDING) {
  if (!readme.includes(phrase)) {
    fail(`README.md no longer contains the branding phrase "${phrase}"`);
  }
}

if (failures.length > 0) {
  console.error(`Version agreement failed (expected ${expected}):\n`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  console.error("\nSee docs/release.md for the full release checklist.");
  process.exit(1);
}

console.log(
  `Version agreement OK at ${expected} ` +
    `(${workspacePackages.length} workspace packages, manifest.json, versions.json, README pins).`,
);
