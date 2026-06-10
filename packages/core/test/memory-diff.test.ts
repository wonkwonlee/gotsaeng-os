import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CONTEXT_MANIFEST_FILE,
  MEMORY_DIFF_FILE,
  createContextManifest,
  diffContextManifests,
  renderMemoryDiff,
  writeContextPack,
  type ContextPack,
  type ExtractedItem
} from "../src/index";

describe("memory diff", () => {
  it("creates a baseline diff when no previous manifest exists", () => {
    const manifest = createContextManifest(createPack([createItem("action", "Write tests.", "open")]));
    const diff = diffContextManifests(null, manifest, "2026-06-06T00:00:00.000Z");

    expect(diff.previousManifestFound).toBe(false);
    expect(diff.summary).toEqual({
      newlyAdded: 0,
      changed: 0,
      newlyStale: 0,
      resolved: 0
    });
    expect(renderMemoryDiff(diff)).toContain("establishes the local memory diff baseline");
  });

  it("surfaces newly added, changed, stale, and resolved context", () => {
    const previous = createContextManifest(
      createPack([
        createItem("action", "Ship plugin.", "open", { priority: "medium" }),
        createItem("risk", "Metadata can drift.", "unknown", { stale: true }),
        createItem("question", "What should v0.7 do?", "open")
      ])
    );
    const current = createContextManifest(
      createPack([
        createItem("action", "Ship plugin.", "done", { priority: "high" }),
        createItem("risk", "Metadata can drift.", "unknown"),
        createItem("action", "Write memory diff.", "open", { stale: true })
      ])
    );

    const diff = diffContextManifests(previous, current, "2026-06-06T00:00:00.000Z");

    expect(diff.summary).toEqual({
      newlyAdded: 1,
      changed: 2,
      newlyStale: 1,
      resolved: 3
    });
    expect(diff.newlyAdded[0]?.text).toBe("Write memory diff.");
    expect(diff.changed.map((item) => item.current.text)).toEqual(["Ship plugin.", "Metadata can drift."]);
    expect(diff.changed.find((item) => item.current.text === "Ship plugin.")?.changes.map((change) => change.field)).toContain(
      "confidenceScore"
    );
    expect(diff.newlyStale[0]?.text).toBe("Write memory diff.");
    expect(diff.resolved.map((item) => item.reason)).toEqual(["now_done", "removed_or_rewritten", "no_longer_stale"]);
  });

  it("writes a second compile diff against the previous manifest", async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "gotsaeng-memory-diff-"));

    await writeContextPack(createPack([createItem("action", "Write memory diff.", "open")]), outputDir);
    await writeContextPack(createPack([createItem("action", "Write memory diff.", "done")]), outputDir);

    const diff = await fs.readFile(path.join(outputDir, MEMORY_DIFF_FILE), "utf8");
    const manifest = JSON.parse(await fs.readFile(path.join(outputDir, CONTEXT_MANIFEST_FILE), "utf8")) as {
      itemCount: number;
    };

    expect(diff).toContain("- Changed: 1");
    expect(diff).toContain("- Resolved: 1");
    expect(diff).toContain("status open -> done");
    expect(manifest.itemCount).toBe(1);
  });
});

function createPack(items: ExtractedItem[]): ContextPack {
  return {
    projectName: "GotSaeng OS",
    generatedAt: "2026-06-06T00:00:00.000Z",
    sourceRoot: "/vault",
    notes: [],
    facts: items.filter((item) => item.kind === "fact"),
    decisions: items.filter((item) => item.kind === "decision"),
    actions: items.filter((item) => item.kind === "action"),
    risks: items.filter((item) => item.kind === "risk"),
    assumptions: items.filter((item) => item.kind === "assumption"),
    questions: items.filter((item) => item.kind === "question"),
    insights: items.filter((item) => item.kind === "insight"),
    contradictions: [],
    staleItems: items.filter((item) => item.status === "stale" || item.tags.includes("stale-test")),
    report: {
      filesScanned: 1,
      markdownFilesParsed: 1,
      filesSkipped: 0,
      parseErrors: [],
      warnings: [],
      generatedFiles: [],
      extractionStats: {
        totalItems: items.length,
        byKind: {},
        byStatus: {},
        notesWithItems: 1,
        notesWithoutItems: 0
      },
      sourceCoverage: {
        noteTypes: { project: 1 },
        notesWithUpdated: 1,
        notesMissingUpdated: 0
      }
    }
  };
}

function createItem(
  kind: ExtractedItem["kind"],
  text: string,
  status: ExtractedItem["status"],
  options: {
    priority?: ExtractedItem["priority"];
    stale?: boolean;
  } = {}
): ExtractedItem {
  return {
    id: `${kind}:source.md:${text}`,
    sourcePath: "source.md",
    sourceTitle: "Source",
    kind,
    text,
    status,
    priority: options.priority,
    updated: options.stale ? "2026-01-01" : "2026-06-06",
    confidence: {
      score: options.priority === "high" ? 88 : options.priority === "medium" ? 78 : 70,
      level: options.priority === "high" ? "high" : "medium",
      signals: [],
      warnings: []
    },
    tags: options.stale ? ["stale-test"] : []
  };
}
