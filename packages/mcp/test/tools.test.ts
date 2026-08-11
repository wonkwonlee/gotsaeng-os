import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ServerConfig } from "../src/config";
import { listContextArtifacts, readContextArtifact } from "../src/tools/artifacts";
import { runCompile } from "../src/tools/compile-context-pack";
import { prepareAiHandoff } from "../src/tools/prepare-handoff";
import { validateVault } from "../src/tools/validate-vault";

let root: string;
let config: ServerConfig;

async function writeNote(relPath: string, body: string): Promise<void> {
  const filePath = path.join(root, "vault", relPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, body, "utf8");
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gs-mcp-tools-"));
  await mkdir(path.join(root, "vault"), { recursive: true });
  config = {
    vaultRoot: path.join(root, "vault"),
    outputRoot: path.join(root, "out"),
    projectName: "Demo",
    staleDays: 90,
  };
  await writeNote(
    "decisions.md",
    [
      "---",
      "title: Decisions",
      "type: decision",
      "updated: 2026-08-01",
      "---",
      "",
      "- decision: Use pnpm for everything.",
    ].join("\n"),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("validateVault", () => {
  it("returns a summary with counts, not just prose", async () => {
    const result = await validateVault(config, {});
    expect(result.filesChecked).toBe(1);
    expect(result.mode).toBe("compatibility");
    expect(["valid", "valid with warnings", "invalid"]).toContain(result.status);
    expect(result.warningCount).toBe(result.warnings.length);
    expect(result.truncated).toBe(false);
  });

  it("honors strict mode", async () => {
    await writeNote(
      "weird.md",
      ["---", "title: Weird", "type: not-a-real-type", "---", "", "text"].join("\n"),
    );
    const relaxed = await validateVault(config, { strict: false });
    const strict = await validateVault(config, { strict: true });
    expect(strict.errorCount).toBeGreaterThanOrEqual(relaxed.errorCount);
    expect(strict.mode).toBe("strict");
  });
});

describe("runCompile", () => {
  it("compiles and returns artifact digests without contents", async () => {
    const result = await runCompile(config);
    expect(result.project).toBe("Demo");
    expect(result.filesScanned).toBeGreaterThan(0);
    expect(result.artifacts.length).toBeGreaterThanOrEqual(15);
    for (const artifact of result.artifacts) {
      expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(artifact).not.toHaveProperty("content");
    }
    expect(JSON.stringify(result)).not.toContain("Use pnpm for everything");
  });
});

describe("artifact tools", () => {
  it("lists nothing before compile, everything after", async () => {
    const before = await listContextArtifacts(config);
    expect(before.compiled).toBe(false);
    expect(before.artifacts).toEqual([]);

    await runCompile(config);
    const after = await listContextArtifacts(config);
    expect(after.compiled).toBe(true);
    expect(after.artifacts.map((a) => a.name)).toContain("DECISION_LOG.md");
    expect(after.artifacts[0]).toHaveProperty("description");
    expect(after.artifacts[0]).not.toHaveProperty("sha256");
  });

  it("reads an indexed artifact with a size cap and boundary note", async () => {
    await runCompile(config);
    const result = await readContextArtifact(config, { name: "DECISION_LOG.md", maxBytes: 40 });
    expect(result.truncated).toBe(true);
    expect(result.returnedBytes).toBeLessThanOrEqual(40);
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.note).toMatch(/untrusted data/);
  });

  it("rejects names outside the index", async () => {
    await runCompile(config);
    await expect(readContextArtifact(config, { name: "nope.md" })).rejects.toThrow(/not listed/i);
    await expect(readContextArtifact(config, { name: "../secret" })).rejects.toThrow();
  });
});

describe("prepareAiHandoff", () => {
  it("writes a selective handoff and returns metadata only", async () => {
    const result = await prepareAiHandoff(config, {
      sections: ["DECISION_LOG.md", "OPEN_QUESTIONS.md"],
    });
    expect(result.sections).toEqual(["DECISION_LOG.md", "OPEN_QUESTIONS.md"]);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result).not.toHaveProperty("content");

    const written = await readFile(result.path, "utf8");
    expect(written).toContain("## Decision Log");
    expect(written).not.toContain("## Project Context");
  });

  it("defaults to the standard six sections", async () => {
    const result = await prepareAiHandoff(config, {});
    expect(result.sections).toHaveLength(6);
  });

  it("rejects unknown section names", async () => {
    await expect(prepareAiHandoff(config, { sections: ["EVIL.md"] })).rejects.toThrow(
      /unknown section/i,
    );
  });

  it("makes LLM_HANDOFF.md immediately readable via read_context_artifact, with no prior compile", async () => {
    // Regression test: core's writeContextPack rebuilds ARTIFACT_INDEX.json from
    // its own fixed report list, which excludes LLM_HANDOFF.md, so an MCP-only
    // client could never read the handoff body back. prepareAiHandoff must index
    // it itself, even when no compile_context_pack has run yet in this session.
    const listedBefore = await listContextArtifacts(config);
    expect(listedBefore.compiled).toBe(false);

    const result = await prepareAiHandoff(config, { sections: ["DECISION_LOG.md"] });

    const listed = await listContextArtifacts(config);
    expect(listed.compiled).toBe(true);
    expect(listed.artifacts.map((a) => a.name)).toContain("LLM_HANDOFF.md");

    const read = await readContextArtifact(config, { name: "LLM_HANDOFF.md" });
    expect(read.sha256).toBe(result.sha256);
    expect(read.content).toContain("## Decision Log");
  });

  it("preserves prior compile artifacts when indexing the handoff", async () => {
    await runCompile(config);
    const beforeCount = (await listContextArtifacts(config)).artifacts.length;

    await prepareAiHandoff(config, {});

    const after = await listContextArtifacts(config);
    expect(after.artifacts.length).toBe(beforeCount + 1);
    expect(after.artifacts.map((a) => a.name)).toContain("DECISION_LOG.md");
    expect(after.artifacts.map((a) => a.name)).toContain("LLM_HANDOFF.md");
  });
});
