#!/usr/bin/env node
/* global console, process */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, cpSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(
  readFileSync(path.join(repoRoot, "package.json"), "utf8"),
).version;

const requiredContextArtifacts = [
  "PROJECT_CONTEXT.md",
  "MEMORY_SNAPSHOT.md",
  "DECISION_LOG.md",
  "ACTION_BACKLOG.md",
  "RISK_REGISTER.md",
  "OPEN_QUESTIONS.md",
  "STALE_CONTEXT.md",
  "SOURCE_PROVENANCE.md",
  "CONFIDENCE.md",
  "CONTRADICTIONS.md",
  "MEMORY_DIFF.md",
  "CONTEXT_MANIFEST.json",
  "COMPILE_REPORT.json",
];

const requiredObsidianArtifacts = ["main.js", "manifest.json", "styles.css"];

function run(command, args, options = {}) {
  const cwd = options.cwd ?? repoRoot;
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status ?? "signal"}): ${command} ${args.join(" ")}`);
  }
}

function assertFile(filePath, label = filePath) {
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    throw new Error(`Missing required file: ${label}`);
  }
}

function assertDirectory(dirPath, label = dirPath) {
  if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
    throw new Error(`Missing required directory: ${label}`);
  }
}

function makeTempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function cleanCloneSmoke() {
  const cloneParent = makeTempDir("gotsaeng-clean-clone-");
  const cloneDir = path.join(cloneParent, "repo");

  console.log(`\n==> Clean clone smoke: ${cloneDir}`);
  run("git", ["clone", "--local", repoRoot, cloneDir], { cwd: cloneParent });
  run("pnpm", ["install", "--frozen-lockfile"], { cwd: cloneDir });
  run("pnpm", ["typecheck"], { cwd: cloneDir });
  run("pnpm", ["test"], { cwd: cloneDir });
  run("pnpm", ["build"], { cwd: cloneDir });
  run("pnpm", ["lint"], { cwd: cloneDir });

  console.log("Clean clone smoke passed.");
}

function packageSmoke() {
  const packDir = makeTempDir("gotsaeng-pack-");
  const installDir = makeTempDir("gotsaeng-install-smoke-");
  const outputDir = makeTempDir("gotsaeng-pack-output-");

  console.log(`\n==> Package smoke: ${packDir}`);
  run("pnpm", ["pack", "--pack-destination", packDir], {
    cwd: path.join(repoRoot, "packages/core"),
  });
  run("pnpm", ["pack", "--pack-destination", packDir], {
    cwd: path.join(repoRoot, "packages/cli"),
  });

  const coreTarball = path.join(packDir, `gotsaeng-core-${packageVersion}.tgz`);
  const cliTarball = path.join(packDir, `gotsaeng-cli-${packageVersion}.tgz`);
  assertFile(coreTarball, "packed @gotsaeng/core tarball");
  assertFile(cliTarball, "packed @gotsaeng/cli tarball");

  run("npm", ["init", "-y"], { cwd: installDir });
  run("npm", ["install", coreTarball, cliTarball], { cwd: installDir });

  const binPath = path.join(
    installDir,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "gotsaeng.cmd" : "gotsaeng",
  );
  assertFile(binPath, "installed gotsaeng bin");
  run(binPath, ["doctor"], { cwd: installDir });
  run(
    binPath,
    [
      "compile",
      path.join(repoRoot, "examples/sample-vault"),
      "--output",
      outputDir,
      "--project",
      "GotSaeng OS",
    ],
    { cwd: installDir },
  );

  for (const artifact of requiredContextArtifacts) {
    assertFile(path.join(outputDir, artifact), `package smoke output ${artifact}`);
  }

  console.log("Package smoke passed.");
}

function obsidianSmoke() {
  const distDir = path.join(repoRoot, "apps/obsidian-plugin/dist");
  const vaultDir = makeTempDir("gotsaeng-obsidian-vault-");
  const pluginDir = path.join(vaultDir, ".obsidian/plugins/gotsaeng-os");

  console.log(`\n==> Obsidian local install smoke: ${vaultDir}`);
  run("pnpm", ["--filter", "@gotsaeng/obsidian-plugin", "build"], { cwd: repoRoot });
  assertDirectory(distDir, "Obsidian plugin dist directory");

  for (const artifact of requiredObsidianArtifacts) {
    assertFile(path.join(distDir, artifact), `Obsidian dist ${artifact}`);
  }

  const manifest = JSON.parse(readFileSync(path.join(distDir, "manifest.json"), "utf8"));
  if (manifest.id !== "gotsaeng-os") {
    throw new Error(`Unexpected Obsidian plugin id: ${manifest.id}`);
  }
  if (manifest.version !== packageVersion) {
    throw new Error(
      `Obsidian manifest version ${manifest.version} does not match root ${packageVersion}`,
    );
  }
  if (manifest.isDesktopOnly !== true) {
    throw new Error("Obsidian manifest must remain desktop-only for local file-system access.");
  }

  cpSync(distDir, pluginDir, { recursive: true });
  for (const artifact of requiredObsidianArtifacts) {
    assertFile(path.join(pluginDir, artifact), `staged Obsidian plugin ${artifact}`);
  }

  const copiedFiles = readdirSync(pluginDir).sort();
  console.log(`Staged Obsidian plugin files: ${copiedFiles.join(", ")}`);
  console.log(
    "Obsidian local install smoke passed. Complete the manual in-app checklist before release.",
  );
}

function help() {
  console.log(
    `Usage: node scripts/release-smoke.mjs <command>\n\nCommands:\n  clean-clone   Clone this repository to a temporary directory and run install + quality gates.\n  package       Pack core/cli tarballs, install them in a temporary npm project, and run gotsaeng.\n  obsidian      Build and stage the Obsidian plugin artifacts in a temporary vault plugin folder.\n  all           Run clean-clone, package, and obsidian smoke checks.\n`,
  );
}

const command = process.argv[2] ?? "help";

try {
  if (command === "clean-clone") {
    cleanCloneSmoke();
  } else if (command === "package") {
    packageSmoke();
  } else if (command === "obsidian") {
    obsidianSmoke();
  } else if (command === "all") {
    cleanCloneSmoke();
    packageSmoke();
    obsidianSmoke();
  } else {
    help();
    process.exitCode = command === "help" || command === "--help" || command === "-h" ? 0 : 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
