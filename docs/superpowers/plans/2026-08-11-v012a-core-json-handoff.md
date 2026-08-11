# v0.12a — Core Handoff Promotion, Artifact Index, CLI JSON Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move LLM-handoff composition from the Obsidian plugin into `@gotsaeng/core`, add a content-addressed `ARTIFACT_INDEX.json` for compiled outputs, and add `--json` output to the CLI — the foundation the MCP server (Phase B) builds on.

**Architecture:** Core keeps its pure-render / effectful-write split: every new feature gets a pure function (`renderLlmHandoff`, `renderArtifactIndex`) plus a write wrapper, mirroring `markdown-exporter.ts` / `json-exporter.ts`. The plugin deletes its local handoff renderer and imports core's. The CLI gains `--json` flags that serialize the same data the text renderers already receive.

**Tech Stack:** TypeScript (strict), zod, vitest, node:crypto (sha256). No new dependencies.

## Global Constraints (from CLAUDE.md)

- pnpm; strict TypeScript; small pure functions.
- No new dependencies, no telemetry, no LLM API calls, no cloud sync.
- Quality gates before finishing: `pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm format:check && pnpm check:versions`.
- Update docs when changing public behavior.
- Never `git checkout -- .` / `git restore .`.
- Tests live in `packages/*/test/**/*.test.ts` and run from the workspace root (`pnpm test` builds first, then runs vitest; during development `pnpm exec vitest run <file>` works, but core `dist` must be current for cross-package imports — run `pnpm --filter @gotsaeng/core build` after core src changes before running cli/plugin tests).

---

### Task 1: Core handoff exporter

**Files:**

- Create: `packages/core/src/exporters/handoff-exporter.ts`
- Modify: `packages/core/src/index.ts` (add one `export *` line)
- Test: `packages/core/test/handoff-exporter.test.ts`

**Interfaces:**

- Consumes: `ContextPack` type from `../schemas/context`; `GENERATED_MARKDOWN_FILES` from `./markdown-exporter`.
- Produces (later tasks and Phase B rely on these exact names):
  - `LLM_HANDOFF_FILE = "LLM_HANDOFF.md"`
  - `DEFAULT_HANDOFF_SECTIONS: readonly GeneratedMarkdownFile[]`
  - `titleFromGeneratedFileName(fileName: string): string`
  - `renderLlmHandoff(pack: ContextPack, files: Partial<Record<string, string>>, options?: { sections?: readonly string[] }): string`

The output for default sections must be byte-identical to the current plugin renderer at `apps/obsidian-plugin/src/reports.ts:199-235` (headings "Project Context", "Memory Snapshot", "Decision Log", "Action Backlog", "Risk Register", "Open Questions"; disclaimer line kept verbatim).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/handoff-exporter.test.ts
import { describe, expect, it } from "vitest";

import {
  DEFAULT_HANDOFF_SECTIONS,
  LLM_HANDOFF_FILE,
  renderLlmHandoff,
  titleFromGeneratedFileName,
} from "../src/exporters/handoff-exporter";
import type { ContextPack } from "../src/schemas/context";

// Only projectName/generatedAt are read by the renderer; cast keeps the fixture small.
const pack = { projectName: "Demo", generatedAt: "2026-08-11" } as ContextPack;

const files: Partial<Record<string, string>> = {
  "PROJECT_CONTEXT.md": "# Project Context: Demo\n\nBody A",
  "MEMORY_SNAPSHOT.md": "# Memory Snapshot\n\nBody B",
  "DECISION_LOG.md": "# Decision Log\n\nBody C",
  "ACTION_BACKLOG.md": "# Action Backlog\n\nBody D",
  "RISK_REGISTER.md": "# Risk Register\n\nBody E",
  "OPEN_QUESTIONS.md": "# Open Questions\n\nBody F",
};

describe("renderLlmHandoff", () => {
  it("renders the default six sections with title-cased headings", () => {
    const out = renderLlmHandoff(pack, files);
    expect(out).toContain("# LLM Handoff: Demo");
    expect(out).toContain("Generated: 2026-08-11");
    expect(out).toContain(
      "This handoff is local-only generated context. It does not include AI-generated analysis.",
    );
    for (const heading of [
      "## Project Context",
      "## Memory Snapshot",
      "## Decision Log",
      "## Action Backlog",
      "## Risk Register",
      "## Open Questions",
    ]) {
      expect(out).toContain(heading);
    }
    // First-line titles of the source files are stripped.
    expect(out).not.toContain("# Project Context: Demo");
    expect(out).toContain("Body A");
  });

  it("honors a selective sections option and preserves order", () => {
    const out = renderLlmHandoff(pack, files, {
      sections: ["DECISION_LOG.md", "RISK_REGISTER.md", "OPEN_QUESTIONS.md"],
    });
    expect(out).toContain("## Decision Log");
    expect(out).toContain("## Risk Register");
    expect(out).toContain("## Open Questions");
    expect(out).not.toContain("## Project Context");
    expect(out.indexOf("## Decision Log")).toBeLessThan(out.indexOf("## Risk Register"));
  });

  it("renders a missing section body as empty rather than throwing", () => {
    const out = renderLlmHandoff(pack, {}, { sections: ["DECISION_LOG.md"] });
    expect(out).toContain("## Decision Log");
  });

  it("exposes stable constants", () => {
    expect(LLM_HANDOFF_FILE).toBe("LLM_HANDOFF.md");
    expect(DEFAULT_HANDOFF_SECTIONS).toEqual([
      "PROJECT_CONTEXT.md",
      "MEMORY_SNAPSHOT.md",
      "DECISION_LOG.md",
      "ACTION_BACKLOG.md",
      "RISK_REGISTER.md",
      "OPEN_QUESTIONS.md",
    ]);
    expect(titleFromGeneratedFileName("STALE_CONTEXT.md")).toBe("Stale Context");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/handoff-exporter.test.ts`
Expected: FAIL — cannot resolve `../src/exporters/handoff-exporter`.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/exporters/handoff-exporter.ts
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
```

Then add to `packages/core/src/index.ts` (alongside the other exporter lines):

```typescript
export * from "./exporters/handoff-exporter";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/handoff-exporter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/exporters/handoff-exporter.ts packages/core/src/index.ts packages/core/test/handoff-exporter.test.ts
git commit -m "feat(core): add LLM handoff exporter with selectable sections"
```

---

### Task 2: Plugin consumes core's handoff renderer

**Files:**

- Modify: `apps/obsidian-plugin/src/reports.ts` (delete local `renderLlmHandoff` at lines 199-235 and local `titleFromReportFile` at lines 387-394; import from core; `stripTitle` stays only if still referenced — after this change it is not, so delete it too)
- Test: `apps/obsidian-plugin/test/reports.test.ts` (existing tests must keep passing unchanged — that is the proof output is identical)

**Interfaces:**

- Consumes: `renderLlmHandoff`, `titleFromGeneratedFileName` from `@gotsaeng/core` (Task 1).
- Produces: `apps/obsidian-plugin/src/reports.ts` re-exports `renderLlmHandoff` so `main.ts` and tests keep their current import paths working:
  `export { renderLlmHandoff } from "@gotsaeng/core";`

- [ ] **Step 1: Rebuild core so the plugin sees the new export**

Run: `pnpm --filter @gotsaeng/core build`
Expected: tsup succeeds.

- [ ] **Step 2: Edit reports.ts**

In `apps/obsidian-plugin/src/reports.ts`:

1. Add `renderLlmHandoff` is NOT added to the existing `@gotsaeng/core` import block — instead add a re-export line right after the imports: `export { renderLlmHandoff } from "@gotsaeng/core";`
2. Add `titleFromGeneratedFileName` to the `@gotsaeng/core` import block.
3. Delete the local `renderLlmHandoff` function (lines 199-235).
4. In `renderCoreReportLinks`, replace the call `titleFromReportFile(fileName)` with `titleFromGeneratedFileName(fileName)`.
5. Delete the local `titleFromReportFile` and `stripTitle` functions.

- [ ] **Step 3: Run the plugin test suite**

Run: `pnpm exec vitest run apps/obsidian-plugin/test/`
Expected: PASS with zero test-file edits (if `reports.test.ts` imported `renderLlmHandoff` from `../src/reports`, the re-export keeps it working). If a test asserted on exact output and fails, the core renderer diverged from the plugin original — fix the core renderer, not the test.

- [ ] **Step 4: Run full gates for the touched packages**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/obsidian-plugin/src/reports.ts
git commit -m "refactor(plugin): consume core handoff renderer, drop local copy"
```

---

### Task 3: Artifact index (pure part)

**Files:**

- Create: `packages/core/src/exporters/artifact-index.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./exporters/artifact-index";`)
- Test: `packages/core/test/artifact-index.test.ts`

**Interfaces:**

- Produces (Phase B's `list_context_artifacts` / `read_context_artifact` rely on these):
  - `ARTIFACT_INDEX_FILE = "ARTIFACT_INDEX.json"`
  - `ArtifactEntrySchema` / `ArtifactEntry = { name: string; bytes: number; sha256: string; description: string }`
  - `ArtifactIndexSchema` / `ArtifactIndex = { projectName: string; generatedAt: string; artifacts: ArtifactEntry[] }`
  - `describeArtifact(name: string): string`
  - `hashArtifactContent(content: string | Uint8Array): string` (sha256 hex, 64 chars)
  - `renderArtifactIndex(index: ArtifactIndex): string` (pretty JSON, schema-validated)
  - `buildArtifactIndex(outputDir: string, fileNames: string[], meta: { projectName: string; generatedAt: string }): Promise<ArtifactIndex>` (reads files, effectful)
  - `writeArtifactIndex(index: ArtifactIndex, outputDir: string): Promise<void>`
  - `readArtifactIndex(outputDir: string): Promise<ArtifactIndex | null>` (null when the file does not exist; throws on malformed JSON/schema)

Note: schemas live in this file, not `schemas/context.ts`, because nothing in the compile pipeline's data model references them; keep `schemas/context.ts` for pack/report shapes. Direct `node:fs/promises` use matches the existing exporter pattern (`json-exporter.ts`); if the core FS-adapter refactor (open issue) lands later, this file migrates with the other exporters.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/artifact-index.test.ts
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

    const index = await buildArtifactIndex(dir, ["A.md", "B.json"], {
      projectName: "Demo",
      generatedAt: "2026-08-11",
    });
    expect(index.artifacts).toHaveLength(2);
    expect(index.artifacts[0]).toMatchObject({ name: "A.md", bytes: 5 });
    expect(index.artifacts[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);

    await writeArtifactIndex(index, dir);
    const roundTripped = await readArtifactIndex(dir);
    expect(roundTripped).toEqual(index);
    expect(renderArtifactIndex(index)).toContain('"projectName": "Demo"');
  });

  it("returns null when no index file exists", async () => {
    expect(await readArtifactIndex(dir)).toBeNull();
  });

  it("names the index file ARTIFACT_INDEX.json (CONTEXT_MANIFEST is taken)", () => {
    expect(ARTIFACT_INDEX_FILE).toBe("ARTIFACT_INDEX.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/artifact-index.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```typescript
// packages/core/src/exporters/artifact-index.ts
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
```

Add `export * from "./exporters/artifact-index";` to `packages/core/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/test/artifact-index.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/exporters/artifact-index.ts packages/core/src/index.ts packages/core/test/artifact-index.test.ts
git commit -m "feat(core): add ARTIFACT_INDEX.json exporter with sha256 per output file"
```

---

### Task 4: Wire artifact index into writeContextPack

**Files:**

- Modify: `packages/core/src/compiler.ts` (`writeContextPack`, lines ~119-152)
- Test: `packages/core/test/compiler.test.ts` (extend the existing writeContextPack test)

**Interfaces:**

- Consumes: `buildArtifactIndex`, `writeArtifactIndex`, `ARTIFACT_INDEX_FILE` from `./exporters/artifact-index` (Task 3).
- Produces: after `writeContextPack`, the output dir contains `ARTIFACT_INDEX.json`; `report.generatedFiles` includes `"ARTIFACT_INDEX.json"` as its last entry; the index covers every generated file EXCEPT itself (no self-hash).

- [ ] **Step 1: Extend the existing compiler test with failing assertions**

Locate the test in `packages/core/test/compiler.test.ts` that calls `writeContextPack` against a temp dir (it exists — the suite covers `generatedFiles`). Add to it:

```typescript
import { readArtifactIndex } from "../src/exporters/artifact-index";

// ...inside the writeContextPack test, after the existing assertions:
expect(report.generatedFiles).toContain("ARTIFACT_INDEX.json");

const index = await readArtifactIndex(outputDir);
expect(index).not.toBeNull();
// Index covers every generated file except itself.
expect(index?.artifacts.map((entry) => entry.name).sort()).toEqual(
  report.generatedFiles.filter((name) => name !== "ARTIFACT_INDEX.json").sort(),
);
for (const entry of index?.artifacts ?? []) {
  expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(entry.bytes).toBeGreaterThan(0);
}
```

If the existing test uses different variable names for `report`/`outputDir`, adapt the names, not the assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/test/compiler.test.ts`
Expected: FAIL — `generatedFiles` lacks `ARTIFACT_INDEX.json`.

- [ ] **Step 3: Implement in writeContextPack**

In `packages/core/src/compiler.ts`, import at top:

```typescript
import {
  ARTIFACT_INDEX_FILE,
  buildArtifactIndex,
  writeArtifactIndex,
} from "./exporters/artifact-index";
```

Change the `generatedFiles` assembly and the tail of `writeContextPack`:

```typescript
const generatedFiles = [
  ...markdownFiles,
  MEMORY_DIFF_FILE,
  CONTEXT_MANIFEST_FILE,
  "COMPILE_REPORT.json",
  ARTIFACT_INDEX_FILE,
];
```

and after `await writeCompileReport(report, outputDir);` (COMPILE_REPORT.json must exist on disk before it can be hashed):

```typescript
const artifactIndex = await buildArtifactIndex(
  outputDir,
  generatedFiles.filter((name) => name !== ARTIFACT_INDEX_FILE),
  { projectName: pack.projectName, generatedAt: pack.generatedAt },
);
await writeArtifactIndex(artifactIndex, outputDir);
return report;
```

- [ ] **Step 4: Run core tests**

Run: `pnpm exec vitest run packages/core/test/`
Expected: PASS. If `snapshot.test.ts` or `json-exporter.test.ts` assert an exact `generatedFiles` list, update those fixtures to include `"ARTIFACT_INDEX.json"` — that is the intended behavior change.

- [ ] **Step 5: Check downstream consumers of generatedFiles**

`apps/obsidian-plugin/src/reports.ts` `renderCoreReportLinks` filters out only `COMPILE_REPORT.json` before rendering wiki links; JSON files should not be wiki-linked. Change the filter to exclude both JSON files:

```typescript
const files = generatedFiles.filter((fileName) => !fileName.endsWith(".json"));
```

Run: `pnpm exec vitest run apps/obsidian-plugin/test/` and fix any fixture expecting the old filter.

- [ ] **Step 6: Full gates and commit**

Run: `pnpm typecheck && pnpm test`
Expected: PASS.

```bash
git add packages/core/src/compiler.ts packages/core/test/compiler.test.ts apps/obsidian-plugin/src/reports.ts
git commit -m "feat(core): emit ARTIFACT_INDEX.json from writeContextPack"
```

---

### Task 5: CLI --json for compile

**Files:**

- Modify: `packages/cli/src/output.ts`, `packages/cli/src/commands/compile.ts`
- Test: `packages/cli/test/output.test.ts`

**Interfaces:**

- Consumes: `CompileSummaryInput` (already in `output.ts`).
- Produces:
  - `CLI_JSON_SCHEMA_VERSION = 1`
  - `renderCompileJson(input: CompileSummaryInput): string`
  - `renderCliErrorJson(input: { title: string; reason: string }): string`
  - `gotsaeng compile <vault> --output <dir> --project <name> --json` prints ONLY the JSON document on stdout (no text summary). Errors with `--json` print a JSON error object on stderr. Exit codes unchanged.

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/test/output.test.ts`:

```typescript
import { renderCliErrorJson, renderCompileJson, CLI_JSON_SCHEMA_VERSION } from "../src/output";

describe("renderCompileJson", () => {
  it("emits a schema-versioned JSON document with report and counts", () => {
    const out = renderCompileJson({
      projectName: "Demo",
      source: "/vault",
      output: "/out",
      itemCounts: { facts: 1 },
      report: {
        filesScanned: 2,
        markdownFilesParsed: 2,
        filesSkipped: 0,
        parseErrors: [],
        warnings: ["w1"],
        generatedFiles: ["PROJECT_CONTEXT.md"],
      },
    });
    const parsed = JSON.parse(out);
    expect(parsed.schemaVersion).toBe(CLI_JSON_SCHEMA_VERSION);
    expect(parsed.command).toBe("compile");
    expect(parsed.project).toBe("Demo");
    expect(parsed.report.warnings).toEqual(["w1"]);
    expect(parsed.itemCounts.facts).toBe(1);
    expect(out.endsWith("\n")).toBe(true);
  });
});

describe("renderCliErrorJson", () => {
  it("emits a JSON error object", () => {
    const parsed = JSON.parse(renderCliErrorJson({ title: "t", reason: "r" }));
    expect(parsed.error).toEqual({ title: "t", reason: "r" });
    expect(parsed.schemaVersion).toBe(CLI_JSON_SCHEMA_VERSION);
  });
});
```

(The existing test file already constructs `CompileReport` fixtures — reuse its fixture helper if one exists rather than the inline object above; keep the assertions.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run packages/cli/test/output.test.ts`
Expected: FAIL — exports missing.

- [ ] **Step 3: Implement renderers and wire the flag**

Append to `packages/cli/src/output.ts`:

```typescript
export const CLI_JSON_SCHEMA_VERSION = 1;

export function renderCompileJson(input: CompileSummaryInput): string {
  return `${JSON.stringify(
    {
      schemaVersion: CLI_JSON_SCHEMA_VERSION,
      command: "compile",
      project: input.projectName,
      source: input.source,
      output: input.output,
      itemCounts: input.itemCounts,
      report: input.report,
    },
    null,
    2,
  )}\n`;
}

export function renderCliErrorJson(input: { title: string; reason: string }): string {
  return `${JSON.stringify(
    { schemaVersion: CLI_JSON_SCHEMA_VERSION, error: { title: input.title, reason: input.reason } },
    null,
    2,
  )}\n`;
}
```

In `packages/cli/src/commands/compile.ts`: add `json?: boolean` to `CompileCommandOptions`, add `.option("--json", "Print a machine-readable JSON summary instead of text.")`, and in the action pick the renderer:

```typescript
const summaryInput = {
  projectName: pack.projectName,
  source: vaultPath,
  output: options.output,
  report,
  itemCounts: getItemCounts(pack),
};
process.stdout.write(
  options.json ? renderCompileJson(summaryInput) : renderCompileSummary(summaryInput),
);
```

and in the catch block:

```typescript
const errorInput = {
  title: "GotSaeng OS compile failed",
  reason: error instanceof Error ? error.message : String(error),
};
process.stderr.write(
  options.json
    ? renderCliErrorJson(errorInput)
    : renderCliError({
        ...errorInput,
        checks: [
          /* keep the existing four check strings */
        ],
      }),
);
```

(Keep the existing `checks` array literal in place — only restructure, don't drop the strings.)

- [ ] **Step 4: Run tests and a real invocation**

Run: `pnpm exec vitest run packages/cli/test/` — expected PASS.
Run end-to-end against the bundled example vault:

```bash
pnpm --filter @gotsaeng/core build && pnpm --filter @gotsaeng/cli build
node packages/cli/dist/index.js compile examples/demo-vault --output /tmp/gs-json-check --project Demo --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.command, j.report.generatedFiles.length)})"
```

(If `examples/` has a differently-named vault dir, `ls examples/` and use what's there.)
Expected: prints `compile <N>` with N ≥ 16.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/output.ts packages/cli/src/commands/compile.ts packages/cli/test/output.test.ts
git commit -m "feat(cli): add --json output to compile"
```

---

### Task 6: CLI --json for validate

**Files:**

- Modify: `packages/cli/src/output.ts`, `packages/cli/src/commands/validate.ts`
- Test: `packages/cli/test/output.test.ts`

**Interfaces:**

- Consumes: `CLI_JSON_SCHEMA_VERSION`, `renderCliErrorJson` (Task 5).
- Produces: `renderValidationJson(input: { source: string; markdownFiles: number; mode: "compatibility" | "strict"; warnings: string[]; errors: string[] }): string` with `status: "valid" | "valid with warnings" | "invalid"` computed the same way `renderValidationSummary` does. `gotsaeng validate <vault> [--strict] --json` prints only JSON; exit code still 1 when errors exist.

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/test/output.test.ts`:

```typescript
import { renderValidationJson } from "../src/output";

describe("renderValidationJson", () => {
  it("computes status and carries full issue lists", () => {
    const parsed = JSON.parse(
      renderValidationJson({
        source: "/vault",
        markdownFiles: 3,
        mode: "strict",
        warnings: ["a: w"],
        errors: [],
      }),
    );
    expect(parsed.command).toBe("validate");
    expect(parsed.status).toBe("valid with warnings");
    expect(parsed.mode).toBe("strict");
    expect(parsed.warnings).toEqual(["a: w"]);
  });

  it("reports invalid when errors exist", () => {
    const parsed = JSON.parse(
      renderValidationJson({
        source: "/vault",
        markdownFiles: 1,
        mode: "compatibility",
        warnings: [],
        errors: ["b: e"],
      }),
    );
    expect(parsed.status).toBe("invalid");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/cli/test/output.test.ts`
Expected: FAIL — `renderValidationJson` missing.

- [ ] **Step 3: Implement**

Append to `packages/cli/src/output.ts`:

```typescript
export function renderValidationJson(input: {
  source: string;
  markdownFiles: number;
  mode: "compatibility" | "strict";
  warnings: string[];
  errors: string[];
}): string {
  const status =
    input.errors.length > 0
      ? "invalid"
      : input.warnings.length > 0
        ? "valid with warnings"
        : "valid";
  return `${JSON.stringify(
    {
      schemaVersion: CLI_JSON_SCHEMA_VERSION,
      command: "validate",
      source: input.source,
      markdownFiles: input.markdownFiles,
      mode: input.mode,
      status,
      warnings: input.warnings,
      errors: input.errors,
    },
    null,
    2,
  )}\n`;
}
```

In `packages/cli/src/commands/validate.ts`: add `json?: boolean` to options type, add `.option("--json", "Print a machine-readable JSON summary instead of text.")`, and switch renderers exactly as in Task 5 (success path: `renderValidationJson` vs `renderValidationSummary` with the same input object plus `mode: strict ? "strict" : "compatibility"`; catch path: `renderCliErrorJson` vs `renderCliError`).

- [ ] **Step 4: Run tests and verify**

Run: `pnpm exec vitest run packages/cli/test/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/output.ts packages/cli/src/commands/validate.ts packages/cli/test/output.test.ts
git commit -m "feat(cli): add --json output to validate"
```

---

### Task 7: Docs, changelog, full gates

**Files:**

- Modify: `docs/cli.md` (if present — check with `ls docs/`; otherwise the CLI section of `README.md`): document `--json` for compile/validate with one sample output block each.
- Modify: `docs/architecture.md`: note that handoff rendering lives in core (`exporters/handoff-exporter.ts`) and the plugin consumes it; note `ARTIFACT_INDEX.json` as a compile output.
- Modify: `CHANGELOG.md`: add an `## Unreleased` section (or extend the existing one) with three lines: core handoff exporter, ARTIFACT_INDEX.json, CLI `--json`.

**Interfaces:** none — docs only.

- [ ] **Step 1: Write the doc updates** (state what changed and the new output file name; keep the existing docs' voice; no marketing language).

- [ ] **Step 2: Run all quality gates**

Run: `pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm format:check && pnpm check:versions`
Expected: all PASS. `format:check` failures → run `pnpm format` and re-check.

- [ ] **Step 3: Commit**

```bash
git add docs/ CHANGELOG.md
git commit -m "docs: document CLI --json, ARTIFACT_INDEX.json, and core handoff exporter"
```

- [ ] **Step 4: Open PR** against dev `main` from `wonkwonlee/v012a-core-json-handoff` titled "v0.12a: core handoff exporter, artifact index, CLI --json". Body summarizes the three features and links `docs/superpowers/plans/2026-08-11-mcp-roadmap.md`.
