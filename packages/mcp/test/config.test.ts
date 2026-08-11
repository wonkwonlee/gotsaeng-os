import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveArtifactPath, resolveServerConfig } from "../src/config";

let vaultDir: string;

beforeEach(async () => {
  vaultDir = await mkdtemp(path.join(tmpdir(), "gs-mcp-vault-"));
});

afterEach(async () => {
  await rm(vaultDir, { recursive: true, force: true });
});

describe("resolveServerConfig", () => {
  it("resolves roots to absolute paths with defaults", async () => {
    const config = await resolveServerConfig({
      vault: vaultDir,
      output: path.join(vaultDir, "..", "gs-mcp-out"),
      project: "Demo",
    });
    expect(path.isAbsolute(config.vaultRoot)).toBe(true);
    expect(path.isAbsolute(config.outputRoot)).toBe(true);
    expect(config.staleDays).toBe(90);
  });

  it("rejects a missing vault directory", async () => {
    await expect(
      resolveServerConfig({ vault: path.join(vaultDir, "nope"), output: "/tmp/o", project: "D" }),
    ).rejects.toThrow(/vault/i);
  });

  it("rejects output equal to vault", async () => {
    await expect(
      resolveServerConfig({ vault: vaultDir, output: vaultDir, project: "D" }),
    ).rejects.toThrow(/output/i);
  });

  it("rejects an output directory nested inside the vault", async () => {
    // Regression test: an equality-only check let `<vault>/out` through, so
    // compile_context_pack would write generated reports into the source
    // vault and a later compile would scan its own output as source notes.
    await expect(
      resolveServerConfig({ vault: vaultDir, output: path.join(vaultDir, "out"), project: "D" }),
    ).rejects.toThrow(/output/i);
  });

  it("accepts an output directory that is merely a sibling of the vault", async () => {
    const config = await resolveServerConfig({
      vault: vaultDir,
      output: path.join(vaultDir, "..", "gs-mcp-sibling-out"),
      project: "D",
    });
    expect(config.outputRoot).not.toBe(vaultDir);
  });

  it("rejects an output directory reached through a symlinked alias of the vault", async () => {
    // Regression test: a lexical-only check (path.relative on path.resolve
    // output) does not follow symlinks, so --vault /tmp/vault --output
    // /tmp/alias/out with `alias -> vault` passed the old check even though
    // /tmp/alias/out is physically inside the vault once the symlink is
    // followed. resolveServerConfig must canonicalize both roots first,
    // including resolving through the nearest existing ancestor of an output
    // path that does not exist yet.
    const parent = await mkdtemp(path.join(tmpdir(), "gs-mcp-symlink-"));
    const realVault = path.join(parent, "vault");
    await mkdir(realVault, { recursive: true });
    const alias = path.join(parent, "alias");
    await symlink(realVault, alias, "dir");

    await expect(
      resolveServerConfig({ vault: realVault, output: path.join(alias, "out"), project: "D" }),
    ).rejects.toThrow(/output/i);

    await rm(parent, { recursive: true, force: true });
  });
});

describe("resolveArtifactPath", () => {
  it("joins plain names", () => {
    expect(resolveArtifactPath("/out", "DECISION_LOG.md")).toBe(
      path.resolve("/out", "DECISION_LOG.md"),
    );
  });

  it.each(["../secret", "a/b.md", "/etc/passwd", "..", ""])(
    "rejects traversal or nested name %s",
    (name) => {
      expect(() => resolveArtifactPath("/out", name)).toThrow(/artifact name/i);
    },
  );
});
