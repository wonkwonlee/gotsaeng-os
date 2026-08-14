export type OutputArtifactGroup = "core" | "governance" | "analysis" | "raw";

export type OutputArtifact = {
  label: string;
  fileName: string;
  format: "markdown" | "json";
  group: OutputArtifactGroup;
};

export const OUTPUT_ARTIFACTS: OutputArtifact[] = [
  { label: "Report Hub", fileName: "REPORT_HUB.md", format: "markdown", group: "core" },
  {
    label: "Weekly Review",
    fileName: "WEEKLY_REVIEW_CONTEXT.md",
    format: "markdown",
    group: "core",
  },
  { label: "LLM Handoff", fileName: "LLM_HANDOFF.md", format: "markdown", group: "core" },
  { label: "Project Context", fileName: "PROJECT_CONTEXT.md", format: "markdown", group: "core" },
  {
    label: "Memory Snapshot",
    fileName: "MEMORY_SNAPSHOT.md",
    format: "markdown",
    group: "core",
  },
  { label: "Decision Log", fileName: "DECISION_LOG.md", format: "markdown", group: "governance" },
  { label: "Action Backlog", fileName: "ACTION_BACKLOG.md", format: "markdown", group: "core" },
  {
    label: "Risk Register",
    fileName: "RISK_REGISTER.md",
    format: "markdown",
    group: "governance",
  },
  {
    label: "Open Questions",
    fileName: "OPEN_QUESTIONS.md",
    format: "markdown",
    group: "governance",
  },
  {
    label: "Stale Context",
    fileName: "STALE_CONTEXT.md",
    format: "markdown",
    group: "governance",
  },
  {
    label: "Validation Report",
    fileName: "VALIDATION_REPORT.md",
    format: "markdown",
    group: "core",
  },
  { label: "Memory Diff", fileName: "MEMORY_DIFF.md", format: "markdown", group: "analysis" },
  {
    label: "Source Provenance",
    fileName: "SOURCE_PROVENANCE.md",
    format: "markdown",
    group: "analysis",
  },
  { label: "Confidence", fileName: "CONFIDENCE.md", format: "markdown", group: "analysis" },
  {
    label: "Contradictions",
    fileName: "CONTRADICTIONS.md",
    format: "markdown",
    group: "analysis",
  },
  {
    label: "Engineering Ops",
    fileName: "ENGINEERING_OPS.md",
    format: "markdown",
    group: "analysis",
  },
  { label: "Team Memory", fileName: "TEAM_MEMORY.md", format: "markdown", group: "analysis" },
  {
    label: "Context Manifest JSON",
    fileName: "CONTEXT_MANIFEST.json",
    format: "json",
    group: "raw",
  },
  {
    label: "Compile Report JSON",
    fileName: "COMPILE_REPORT.json",
    format: "json",
    group: "raw",
  },
  {
    label: "Artifact Index JSON",
    fileName: "ARTIFACT_INDEX.json",
    format: "json",
    group: "raw",
  },
];

export const DEFAULT_OUTPUT_ARTIFACT: OutputArtifact = OUTPUT_ARTIFACTS[0]!;

export const ARTIFACT_GROUP_LABELS: Record<OutputArtifactGroup, string> = {
  core: "Core Reports",
  governance: "Governance",
  analysis: "Analysis",
  raw: "Raw Data",
};

// Stable render order for grouped artifact buttons: core reports first (the
// files most people open), then governance reports (a Core Reports subset
// split out to keep every group at roughly 7 items or fewer — see the
// cognitive-load guideline this addresses), then analysis reports, then raw
// JSON. Groups with zero artifacts (shouldn't happen today, but a future edit
// could empty one) are skipped rather than rendered as an empty heading.
const ARTIFACT_GROUP_ORDER: OutputArtifactGroup[] = ["core", "governance", "analysis", "raw"];

export type ArtifactGroupSection = {
  group: OutputArtifactGroup;
  label: string;
  artifacts: OutputArtifact[];
};

export function groupOutputArtifacts(
  artifacts: OutputArtifact[] = OUTPUT_ARTIFACTS,
): ArtifactGroupSection[] {
  return ARTIFACT_GROUP_ORDER.map((group) => ({
    group,
    label: ARTIFACT_GROUP_LABELS[group],
    artifacts: artifacts.filter((artifact) => artifact.group === group),
  })).filter((section) => section.artifacts.length > 0);
}
