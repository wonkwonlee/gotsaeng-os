import {
  compileContextPack,
  DEFAULT_HANDOFF_SECTIONS,
  describeArtifact,
  GENERATED_MARKDOWN_FILES,
  hashArtifactContent,
  LLM_HANDOFF_FILE,
  readArtifactIndex,
  renderLlmHandoff,
  renderMarkdownFiles,
  writeArtifactIndex,
  type ArtifactEntry,
  type FileSystemAdapter,
} from "@gotsaeng/core";

import { resolveArtifactPath, type ServerConfig } from "../config";
import { createNodeFileSystemAdapter } from "../node-file-system";
import { UNTRUSTED_CONTENT_NOTE } from "./artifacts";

export async function prepareAiHandoff(
  config: ServerConfig,
  input: { sections?: string[] },
): Promise<{ path: string; bytes: number; sha256: string; sections: string[]; note: string }> {
  const sections = input.sections ?? [...DEFAULT_HANDOFF_SECTIONS];
  const known = new Set<string>(GENERATED_MARKDOWN_FILES);
  for (const section of sections) {
    if (!known.has(section)) {
      throw new Error(
        `Unknown section ${JSON.stringify(section)}. Valid sections: ${GENERATED_MARKDOWN_FILES.join(", ")}`,
      );
    }
  }

  const fsAdapter = createNodeFileSystemAdapter();
  const pack = await compileContextPack(fsAdapter, {
    sourceRoot: config.vaultRoot,
    projectName: config.projectName,
    staleDays: config.staleDays,
  });
  const files = renderMarkdownFiles(pack);
  const handoff = renderLlmHandoff(pack, files, { sections });

  const filePath = resolveArtifactPath(config.outputRoot, LLM_HANDOFF_FILE);
  await fsAdapter.writeText(filePath, handoff);

  const bytes = Buffer.byteLength(handoff, "utf8");
  const sha256 = hashArtifactContent(handoff);
  await indexHandoffArtifact(
    fsAdapter,
    config.outputRoot,
    { name: LLM_HANDOFF_FILE, bytes, sha256, description: describeArtifact(LLM_HANDOFF_FILE) },
    { projectName: pack.projectName, generatedAt: pack.generatedAt },
  );

  return {
    path: filePath,
    bytes,
    sha256,
    sections,
    note: UNTRUSTED_CONTENT_NOTE,
  };
}

// core's writeContextPack rebuilds ARTIFACT_INDEX.json from its own fixed
// generated-report list on every compile, which does not know about
// LLM_HANDOFF.md — so without this, an MCP-only client could never read the
// handoff body back via read_context_artifact/list_context_artifacts. Upsert
// the entry here so the handoff is indexed immediately after this call, not
// only (and not correctly, since compile would drop it again) after a
// subsequent compile_context_pack.
async function indexHandoffArtifact(
  fsAdapter: FileSystemAdapter,
  outputRoot: string,
  entry: ArtifactEntry,
  fallbackMeta: { projectName: string; generatedAt: string },
): Promise<void> {
  const existing = await readArtifactIndex(fsAdapter, outputRoot);
  const artifacts = existing
    ? [...existing.artifacts.filter((artifact) => artifact.name !== entry.name), entry]
    : [entry];

  await writeArtifactIndex(
    fsAdapter,
    {
      projectName: existing?.projectName ?? fallbackMeta.projectName,
      generatedAt: existing?.generatedAt ?? fallbackMeta.generatedAt,
      artifacts,
    },
    outputRoot,
  );
}
