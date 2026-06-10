import fs from "node:fs/promises";
import path from "node:path";

import { CompileReportSchema, type CompileReport } from "../schemas/context";

export function renderCompileReport(report: CompileReport): string {
  return `${JSON.stringify(CompileReportSchema.parse(report), null, 2)}\n`;
}

export async function writeCompileReport(report: CompileReport, outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "COMPILE_REPORT.json"), renderCompileReport(report), "utf8");
}
