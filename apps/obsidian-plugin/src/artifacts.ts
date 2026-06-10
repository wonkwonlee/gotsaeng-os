export type OutputArtifact = {
  label: string;
  fileName: string;
  format: "markdown" | "json";
};

export const OUTPUT_ARTIFACTS: OutputArtifact[] = [
  { label: "Report Hub", fileName: "REPORT_HUB.md", format: "markdown" },
  { label: "Weekly Review", fileName: "WEEKLY_REVIEW_CONTEXT.md", format: "markdown" },
  { label: "LLM Handoff", fileName: "LLM_HANDOFF.md", format: "markdown" },
  { label: "Memory Diff", fileName: "MEMORY_DIFF.md", format: "markdown" },
  { label: "Project Context", fileName: "PROJECT_CONTEXT.md", format: "markdown" },
  { label: "Memory Snapshot", fileName: "MEMORY_SNAPSHOT.md", format: "markdown" },
  { label: "Decision Log", fileName: "DECISION_LOG.md", format: "markdown" },
  { label: "Action Backlog", fileName: "ACTION_BACKLOG.md", format: "markdown" },
  { label: "Risk Register", fileName: "RISK_REGISTER.md", format: "markdown" },
  { label: "Open Questions", fileName: "OPEN_QUESTIONS.md", format: "markdown" },
  { label: "Stale Context", fileName: "STALE_CONTEXT.md", format: "markdown" },
  { label: "Source Provenance", fileName: "SOURCE_PROVENANCE.md", format: "markdown" },
  { label: "Confidence", fileName: "CONFIDENCE.md", format: "markdown" },
  { label: "Contradictions", fileName: "CONTRADICTIONS.md", format: "markdown" },
  { label: "Validation Report", fileName: "VALIDATION_REPORT.md", format: "markdown" },
  { label: "Context Manifest JSON", fileName: "CONTEXT_MANIFEST.json", format: "json" },
  { label: "Compile Report JSON", fileName: "COMPILE_REPORT.json", format: "json" }
];

export const DEFAULT_OUTPUT_ARTIFACT: OutputArtifact = {
  label: "Report Hub",
  fileName: "REPORT_HUB.md",
  format: "markdown"
};
