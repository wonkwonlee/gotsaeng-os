import {
  compileContextPack,
  getItemCounts,
  readArtifactIndex,
  writeContextPack,
} from "@gotsaeng/core";

import type { ServerConfig } from "../config";
import { createNodeFileSystemAdapter } from "../node-file-system";

export type CompileResult = {
  project: string;
  outputRoot: string;
  filesScanned: number;
  markdownFilesParsed: number;
  itemCounts: Record<string, number>;
  warningCount: number;
  parseErrorCount: number;
  artifacts: Array<{ name: string; bytes: number; sha256: string }>;
};

export async function runCompile(config: ServerConfig): Promise<CompileResult> {
  const fsAdapter = createNodeFileSystemAdapter();
  const pack = await compileContextPack(fsAdapter, {
    sourceRoot: config.vaultRoot,
    projectName: config.projectName,
    staleDays: config.staleDays,
  });
  const report = await writeContextPack(fsAdapter, pack, config.outputRoot);
  const index = await readArtifactIndex(fsAdapter, config.outputRoot);

  return {
    project: pack.projectName,
    outputRoot: config.outputRoot,
    filesScanned: report.filesScanned,
    markdownFilesParsed: report.markdownFilesParsed,
    itemCounts: getItemCounts(pack),
    warningCount: report.warnings.length,
    parseErrorCount: report.parseErrors.length,
    artifacts: (index?.artifacts ?? []).map(({ name, bytes, sha256 }) => ({ name, bytes, sha256 })),
  };
}
