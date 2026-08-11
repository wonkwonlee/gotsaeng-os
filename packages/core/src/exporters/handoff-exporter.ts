import type { ContextPack } from "../schemas/context";
import type { GeneratedMarkdownFile } from "./markdown-exporter";

export const LLM_HANDOFF_FILE = "LLM_HANDOFF.md";

// The default handoff bundles the six decision-facing reports. Order matters:
// it is the reading order of the emitted document.
export const DEFAULT_HANDOFF_SECTIONS: readonly GeneratedMarkdownFile[] = [
  "PROJECT_CONTEXT.md",
  "MEMORY_SNAPSHOT.md",
  "DECISION_LOG.md",
  "ACTION_BACKLOG.md",
  "RISK_REGISTER.md",
  "OPEN_QUESTIONS.md",
];

export type HandoffOptions = {
  sections?: readonly string[];
};

export function titleFromGeneratedFileName(fileName: string): string {
  return fileName
    .replace(/\.md$/i, "")
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function renderLlmHandoff(
  pack: ContextPack,
  files: Partial<Record<string, string>>,
  options: HandoffOptions = {},
): string {
  const sections = options.sections ?? DEFAULT_HANDOFF_SECTIONS;
  const parts = [
    `# LLM Handoff: ${pack.projectName}`,
    "",
    `Generated: ${pack.generatedAt}`,
    "",
    "This handoff is local-only generated context. It does not include AI-generated analysis.",
    "",
  ];

  for (const fileName of sections) {
    parts.push(
      `## ${titleFromGeneratedFileName(fileName)}`,
      "",
      stripTitle(files[fileName] ?? ""),
      "",
    );
  }

  return parts.join("\n");
}

function stripTitle(markdown: string): string {
  return markdown
    .split(/\r?\n/)
    .filter((line, index) => !(index === 0 && /^#\s+/.test(line)))
    .join("\n")
    .trim();
}
