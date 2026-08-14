import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ARTIFACT_INDEX_FILE,
  buildArtifactIndex,
  describeArtifact,
  hashArtifactContent,
  readArtifactIndex,
  renderArtifactIndex,
  writeArtifactIndex,
} from "../src/exporters/artifact-index";
import { createNodeFileSystemAdapter } from "./helpers/node-file-system";

const fsAdapter = createNodeFileSystemAdapter();
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gotsaeng-artifact-index-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("artifact index", () => {
  it("hashes content as 64-char sha256 hex", () => {
    expect(hashArtifactContent("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("describes known files and falls back for unknown ones", () => {
    expect(describeArtifact("DECISION_LOG.md")).toMatch(/decision/i);
    expect(describeArtifact("UNKNOWN.md")).toBe("Generated context-pack file.");
  });

  it("builds, writes, and reads back an index over real files", async () => {
    await writeFile(path.join(dir, "A.md"), "alpha", "utf8");
    await writeFile(path.join(dir, "B.json"), "{}", "utf8");

    const index = await buildArtifactIndex(fsAdapter, dir, ["A.md", "B.json"], {
      projectName: "Demo",
      generatedAt: "2026-08-11",
    });
    expect(index.artifacts).toHaveLength(2);
    expect(index.artifacts[0]).toMatchObject({ name: "A.md", bytes: 5 });
    expect(index.artifacts[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);

    await writeArtifactIndex(fsAdapter, index, dir);
    const roundTripped = await readArtifactIndex(fsAdapter, dir);
    expect(roundTripped).toEqual(index);
    expect(renderArtifactIndex(index)).toContain('"projectName": "Demo"');
  });

  it("returns null when no index file exists", async () => {
    expect(await readArtifactIndex(fsAdapter, dir)).toBeNull();
  });

  it("names the index file ARTIFACT_INDEX.json (CONTEXT_MANIFEST is taken)", () => {
    expect(ARTIFACT_INDEX_FILE).toBe("ARTIFACT_INDEX.json");
  });
});
