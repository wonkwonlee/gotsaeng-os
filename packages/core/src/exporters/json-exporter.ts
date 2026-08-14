import path from "node:path";

import type { FileSystemAdapter } from "../adapters/file-system";
import { CompileReportSchema, type CompileReport } from "../schemas/context";

export function renderCompileReport(report: CompileReport): string {
  return `${JSON.stringify(CompileReportSchema.parse(report), null, 2)}\n`;
}

export async function writeCompileReport(
  fsAdapter: FileSystemAdapter,
  report: CompileReport,
  outputDir: string,
): Promise<void> {
  await fsAdapter.mkdir(outputDir);
  await fsAdapter.writeText(
    path.join(outputDir, "COMPILE_REPORT.json"),
    renderCompileReport(report),
  );
}
