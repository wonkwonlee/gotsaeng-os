import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

// Output-file index for compiled artifacts. Named ARTIFACT_INDEX because
// CONTEXT_MANIFEST.json already means the item-level manifest (memory-diff.ts).
export const ARTIFACT_INDEX_FILE = "ARTIFACT_INDEX.json";

export const ArtifactEntrySchema = z.object({
  name: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  description: z.string().min(1),
});

export type ArtifactEntry = z.infer<typeof ArtifactEntrySchema>;

export const ArtifactIndexSchema = z.object({
  projectName: z.string().min(1),
  generatedAt: z.string().min(1),
  artifacts: z.array(ArtifactEntrySchema),
});

export type ArtifactIndex = z.infer<typeof ArtifactIndexSchema>;

const ARTIFACT_DESCRIPTIONS: Record<string, string> = {
  "PROJECT_CONTEXT.md": "Project overview: objective, key facts, and orientation context.",
  "MEMORY_SNAPSHOT.md": "Current extracted memory: facts, assumptions, and insights.",
  "DECISION_LOG.md": "Decisions extracted from the vault with sources.",
  "ACTION_BACKLOG.md": "Open and active action items with status and priority.",
  "RISK_REGISTER.md": "Identified risks with sources.",
  "OPEN_QUESTIONS.md": "Unresolved questions extracted from the vault.",
  "STALE_CONTEXT.md": "Items whose source notes have not been updated recently.",
  "SOURCE_PROVENANCE.md": "Provenance scores describing how well items are sourced.",
  "CONFIDENCE.md": "Confidence scores for extracted items.",
  "CONTRADICTIONS.md": "Candidate contradictions between extracted items.",
  "ENGINEERING_OPS.md": "Engineering/operations context extracted from the vault.",
  "TEAM_MEMORY.md": "Team-facing summary with handoff notes.",
  "MEMORY_DIFF.md": "Changes since the previous compile (added/removed/changed items).",
  "CONTEXT_MANIFEST.json": "Item-level manifest used to compute MEMORY_DIFF.md.",
  "COMPILE_REPORT.json": "Machine-readable compile report: counts, warnings, stats.",
  "LLM_HANDOFF.md": "Bundled handoff document composed from selected reports.",
};

export function describeArtifact(name: string): string {
  return ARTIFACT_DESCRIPTIONS[name] ?? "Generated context-pack file.";
}

export function hashArtifactContent(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function renderArtifactIndex(index: ArtifactIndex): string {
  return `${JSON.stringify(ArtifactIndexSchema.parse(index), null, 2)}\n`;
}

export async function buildArtifactIndex(
  outputDir: string,
  fileNames: string[],
  meta: { projectName: string; generatedAt: string },
): Promise<ArtifactIndex> {
  const artifacts: ArtifactEntry[] = [];
  for (const name of fileNames) {
    const content = await fs.readFile(path.join(outputDir, name));
    artifacts.push({
      name,
      bytes: content.byteLength,
      sha256: hashArtifactContent(content),
      description: describeArtifact(name),
    });
  }
  return ArtifactIndexSchema.parse({ ...meta, artifacts });
}

export async function writeArtifactIndex(index: ArtifactIndex, outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, ARTIFACT_INDEX_FILE), renderArtifactIndex(index), "utf8");
}

export async function readArtifactIndex(outputDir: string): Promise<ArtifactIndex | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(outputDir, ARTIFACT_INDEX_FILE), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return ArtifactIndexSchema.parse(JSON.parse(raw));
}
