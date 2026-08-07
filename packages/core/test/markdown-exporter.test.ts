import { describe, expect, it } from "vitest";

import { scoreExtractionConfidence, type ExtractionConfidenceSource } from "../src/confidence";
import {
  REGISTER_ITEM_CAP,
  RISK_REGISTER_CAP,
  renderActionBacklog,
  renderCoverageLines,
  renderEngineeringOps,
  renderMarkdownFiles,
  renderMemorySnapshot,
  renderOpenQuestions,
  renderRiskRegister,
  renderTeamMemory,
  renderWarningTriage,
} from "../src/exporters/markdown-exporter";
import type { CompileReport, ContextPack, ExtractedItem } from "../src/schemas/context";
import type { NoteDocument, NoteType } from "../src/schemas/note";

function makeNote(input: { path: string; noteType: NoteType; updated?: string }): NoteDocument {
  return {
    id: input.path,
    path: input.path,
    title: input.path,
    body: "",
    frontmatter: {},
    noteType: input.noteType,
    tags: [],
    updated: input.updated,
    raw: "",
  };
}

function makeItem(input: {
  note: NoteDocument;
  text: string;
  source: ExtractionConfidenceSource;
  kind?: ExtractedItem["kind"];
  status?: ExtractedItem["status"];
}): ExtractedItem {
  const kind = input.kind ?? "risk";
  const base = {
    id: `${input.note.path}|${kind}|${input.text}`,
    sourcePath: input.note.path,
    sourceTitle: input.note.title,
    kind,
    text: input.text,
    status: input.status ?? "open",
    created: input.note.created,
    updated: input.note.updated,
    confidenceSource: input.source,
    tags: [] as string[],
  };

  return {
    ...base,
    confidence: scoreExtractionConfidence(input.note, base, input.source),
  };
}

function makeRiskItem(input: {
  note: NoteDocument;
  text: string;
  source: ExtractionConfidenceSource;
}): ExtractedItem {
  return makeItem({ ...input, kind: "risk" });
}

function makePack(overrides: Partial<ContextPack> = {}): ContextPack {
  return {
    projectName: "Research Vault",
    generatedAt: "2026-06-11T00:00:00.000Z",
    sourceRoot: "/vault",
    notes: [],
    facts: [],
    decisions: [],
    actions: [],
    risks: [],
    assumptions: [],
    questions: [],
    insights: [],
    contradictions: [],
    staleItems: [],
    report: {
      filesScanned: 0,
      markdownFilesParsed: 0,
      filesSkipped: 0,
      parseErrors: [],
      warnings: [],
      generatedFiles: [],
    },
    ...overrides,
  };
}

function sectionOf(markdown: string, heading: string): string {
  return markdown.split(/^## /m).find((section) => section.startsWith(`${heading}\n`)) ?? "";
}

describe("renderRiskRegister", () => {
  it("caps the risk register but never drops explicit-marker risks", () => {
    // A weak source: explicit markers here score LOW so the cap test proves
    // explicit risks are retained on source identity, not on confidence rank.
    const weakNote = makeNote({ path: "/vault/30_Research/weak.md", noteType: "unknown" });
    // A strong source: section_line risks here score HIGHER than the explicit ones.
    const strongNote = makeNote({
      path: "/vault/30_Research/strong.md",
      noteType: "research",
      updated: "2026-06-01",
    });

    const explicitTexts = Array.from(
      { length: 5 },
      (_unused, index) => `Explicit risk ${index + 1}`,
    );
    const sectionTexts = Array.from(
      { length: 250 },
      (_unused, index) => `Section risk ${index + 1}`,
    );

    const sectionRisks = sectionTexts.map((text) =>
      makeRiskItem({ note: strongNote, text, source: "section_line" }),
    );
    const explicitRisks = explicitTexts.map((text) =>
      makeRiskItem({ note: weakNote, text, source: "explicit_marker" }),
    );

    // Explicit risks have lower confidence than section risks, and are placed
    // last in the array, so only explicit-first ordering can rescue them.
    const sectionScore = sectionRisks[0]?.confidence?.score ?? 0;
    const explicitScore = explicitRisks[0]?.confidence?.score ?? 0;
    expect(explicitScore).toBeLessThan(sectionScore);

    const pack = makePack({ risks: [...sectionRisks, ...explicitRisks] });
    const rendered = renderRiskRegister(pack);

    // Every explicit-marker risk survives the cap.
    for (const text of explicitTexts) {
      expect(rendered).toContain(text);
    }

    // The register is bounded: the omission footer is present and the number of
    // rendered item lines does not exceed the cap (plus the single footer line).
    expect(rendered).toContain("more items omitted");
    const itemLines = rendered.split("\n").filter((line) => line.startsWith("- "));
    expect(itemLines.length).toBeLessThanOrEqual(RISK_REGISTER_CAP + 1);

    // Lower-confidence section risks are the ones trimmed once the cap is hit.
    // The trailing word boundary keeps "Section risk 1" from matching "Section risk 10".
    const sectionPresent = sectionTexts.filter((text) =>
      new RegExp(`${text}\\b`).test(rendered),
    ).length;
    expect(sectionPresent).toBe(RISK_REGISTER_CAP - explicitTexts.length);
  });

  it("renders every explicit-marker risk even when explicit markers alone exceed the cap (#18)", () => {
    const note = makeNote({
      path: "/vault/30_Research/explicit-heavy.md",
      noteType: "research",
      updated: "2026-06-01",
    });
    const explicitTexts = Array.from(
      { length: RISK_REGISTER_CAP + 50 },
      (_unused, index) => `Explicit overflow risk ${index + 1}`,
    );
    const explicitRisks = explicitTexts.map((text) =>
      makeRiskItem({ note, text, source: "explicit_marker" }),
    );

    const rendered = renderRiskRegister(makePack({ risks: explicitRisks }));

    for (const text of explicitTexts) {
      expect(rendered).toContain(text);
    }
    expect(rendered).not.toContain("more items omitted");
  });

  it("overrides the register cap via the caps option (#10)", () => {
    const note = makeNote({
      path: "/vault/30_Research/custom-cap.md",
      noteType: "research",
      updated: "2026-06-01",
    });
    const risks = Array.from({ length: 10 }, (_unused, index) =>
      makeRiskItem({ note, text: `Risk ${index + 1}`, source: "section_line" }),
    );

    const rendered = renderRiskRegister(makePack({ risks }), { register: 3 });

    expect(rendered).toContain("... 7 more items omitted");
    const itemLines = rendered.split("\n").filter((line) => line.startsWith("- Risk "));
    expect(itemLines).toHaveLength(3);
  });
});

describe("dedicated register caps", () => {
  // A weak source (explicit markers score LOW) plus a strong source (section_line
  // items score HIGHER), so only explicit-first ordering — not confidence rank —
  // can keep the explicit items once the cap trims the list.
  function buildOverflow(kind: ExtractedItem["kind"], status: ExtractedItem["status"]) {
    const weakNote = makeNote({ path: "/vault/30_Research/weak.md", noteType: "unknown" });
    const strongNote = makeNote({
      path: "/vault/30_Research/strong.md",
      noteType: "research",
      updated: "2026-06-01",
    });
    const explicitTexts = Array.from({ length: 5 }, (_unused, i) => `Explicit ${kind} ${i + 1}`);
    const sectionTexts = Array.from({ length: 250 }, (_unused, i) => `Section ${kind} ${i + 1}`);
    const items = [
      ...sectionTexts.map((text) =>
        makeItem({ note: strongNote, text, source: "section_line", kind, status }),
      ),
      ...explicitTexts.map((text) =>
        makeItem({ note: weakNote, text, source: "explicit_marker", kind, status }),
      ),
    ];
    return { explicitTexts, sectionTexts, items };
  }

  function assertCapped(rendered: string, explicitTexts: string[], sectionTexts: string[]) {
    for (const text of explicitTexts) {
      expect(rendered).toContain(text);
    }
    expect(rendered).toContain("more items omitted");
    const sectionPresent = sectionTexts.filter((text) =>
      new RegExp(`${text}\\b`).test(rendered),
    ).length;
    expect(sectionPresent).toBe(REGISTER_ITEM_CAP - explicitTexts.length);
  }

  it("caps the action backlog but keeps explicit-marker actions", () => {
    const { explicitTexts, sectionTexts, items } = buildOverflow("action", "open");
    assertCapped(renderActionBacklog(makePack({ actions: items })), explicitTexts, sectionTexts);
  });

  it("caps open questions but keeps explicit-marker questions", () => {
    const { explicitTexts, sectionTexts, items } = buildOverflow("question", "open");
    assertCapped(renderOpenQuestions(makePack({ questions: items })), explicitTexts, sectionTexts);
  });

  it("caps memory-snapshot durable facts but keeps explicit-marker facts", () => {
    const { explicitTexts, sectionTexts, items } = buildOverflow("fact", "open");
    assertCapped(renderMemorySnapshot(makePack({ facts: items })), explicitTexts, sectionTexts);
  });

  it("leaves a register unchanged when it is within the cap", () => {
    const note = makeNote({
      path: "/vault/notes/a.md",
      noteType: "research",
      updated: "2026-06-01",
    });
    const items = Array.from({ length: 3 }, (_unused, i) =>
      makeItem({
        note,
        text: `Question ${i + 1}`,
        source: "section_line",
        kind: "question",
        status: "open",
      }),
    );
    const rendered = renderOpenQuestions(makePack({ questions: items }));

    expect(rendered).not.toContain("more items omitted");
    for (const item of items) {
      expect(rendered).toContain(item.text);
    }
  });
});

describe("configurable caps (#10)", () => {
  it("overrides the Memory Snapshot insights cap independently of the register cap", () => {
    const note = makeNote({
      path: "/vault/30_Research/insights.md",
      noteType: "research",
      updated: "2026-06-01",
    });
    const insights = Array.from({ length: 5 }, (_unused, index) =>
      makeItem({ note, text: `Insight ${index + 1}`, source: "section_line", kind: "insight" }),
    );

    const rendered = renderMemorySnapshot(makePack({ insights }), { insights: 2 });

    const insightsSection = sectionOf(rendered, "Insights");
    expect(insightsSection).toContain("... 3 more items omitted");
    expect(insightsSection).toContain("Insight 1");
    expect(insightsSection).not.toContain("Insight 5");
  });

  it("threads caps through renderMarkdownFiles into every capped register", () => {
    const note = makeNote({
      path: "/vault/30_Research/threaded.md",
      noteType: "research",
      updated: "2026-06-01",
    });
    const risks = Array.from({ length: 6 }, (_unused, index) =>
      makeRiskItem({ note, text: `Risk ${index + 1}`, source: "section_line" }),
    );

    const files = renderMarkdownFiles(makePack({ risks }), { register: 2 });

    expect(files["RISK_REGISTER.md"]).toContain("... 4 more items omitted");
  });
});

describe("renderActionBacklog status coverage", () => {
  const note = makeNote({ path: "/vault/notes/a.md", noteType: "research", updated: "2026-06-01" });

  it("renders actions for every status so none are silently dropped", () => {
    const statuses: ExtractedItem["status"][] = ["open", "active", "stale", "done", "unknown"];
    const actions = statuses.map((status) =>
      makeItem({ note, text: `Action ${status}`, source: "task_list", kind: "action", status }),
    );

    const rendered = renderActionBacklog(makePack({ actions }));

    for (const status of statuses) {
      expect(rendered).toContain(`Action ${status}`);
    }
    expect(rendered).toContain("## Stale");
  });

  it("keeps an action with an undefined status in the Unknown bucket", () => {
    const action = makeItem({
      note,
      text: "Action no status",
      source: "task_list",
      kind: "action",
    });
    const pack = makePack({ actions: [{ ...action, status: undefined }] });

    expect(renderActionBacklog(pack)).toContain("Action no status");
  });

  it("routes detector-flagged stale actions into the Stale section only", () => {
    // detectStaleItems returns stale-marked *copies*, so the original in
    // pack.actions still reads "open". The backlog must follow pack.staleItems.
    const action = makeItem({
      note,
      text: "Revisit the old checklist",
      source: "task_list",
      kind: "action",
    });
    const pack = makePack({ actions: [action], staleItems: [{ ...action, status: "stale" }] });

    const rendered = renderActionBacklog(pack);

    expect(sectionOf(rendered, "Stale")).toContain("Revisit the old checklist");
    expect(sectionOf(rendered, "Open")).not.toContain("Revisit the old checklist");
  });

  it("keeps a done action in Done even when the detector flags it as stale", () => {
    const action = makeItem({
      note,
      text: "Ship the quickstart",
      source: "task_list",
      kind: "action",
      status: "done",
    });
    const pack = makePack({ actions: [action], staleItems: [{ ...action, status: "stale" }] });

    const rendered = renderActionBacklog(pack);

    expect(sectionOf(rendered, "Done")).toContain("Ship the quickstart");
    expect(sectionOf(rendered, "Stale")).not.toContain("Ship the quickstart");
  });

  it("ignores stale items that are not actions", () => {
    const risk = makeItem({ note, text: "A stale risk", source: "task_list", kind: "risk" });
    const action = makeItem({ note, text: "A live action", source: "task_list", kind: "action" });
    const pack = makePack({ actions: [action], staleItems: [{ ...risk, status: "stale" }] });

    const rendered = renderActionBacklog(pack);

    expect(sectionOf(rendered, "Open")).toContain("A live action");
    expect(rendered).not.toContain("A stale risk");
  });
});

// The Obsidian Report Hub renders these through the same functions with trimming
// options, so both shapes are exercised here rather than duplicated in the plugin.
describe("shared report summaries", () => {
  function makeReport(overrides: Partial<CompileReport> = {}): CompileReport {
    return {
      filesScanned: 9,
      markdownFilesParsed: 7,
      filesSkipped: 2,
      parseErrors: [],
      warnings: [],
      generatedFiles: [],
      ...overrides,
    };
  }

  it("includes the note-type breakdown by default and omits it on request", () => {
    const report = makeReport({
      sourceCoverage: {
        notesWithUpdated: 5,
        notesMissingUpdated: 2,
        noteTypes: { project: 4, research: 3 },
      },
    });

    expect(renderCoverageLines(report).join("\n")).toContain(
      "- Note types: project: 4, research: 3",
    );
    expect(renderCoverageLines(report, { includeNoteTypes: false }).join("\n")).not.toContain(
      "Note types",
    );
  });

  it("always reports the scan counters regardless of the note-type option", () => {
    const lines = renderCoverageLines(makeReport(), { includeNoteTypes: false });

    expect(lines).toContain("- Files scanned: 9");
    expect(lines).toContain("- Markdown files parsed: 7");
    expect(lines).toContain("- Files skipped: 2");
    expect(lines).toContain("- Warnings: 0");
  });

  it("caps triage examples only when maxExamples is given", () => {
    const report = makeReport({
      warningTriage: {
        totalWarnings: 6,
        totalParseErrors: 0,
        items: [
          {
            label: "Missing updated field",
            count: 6,
            severity: "warning",
            examples: ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md"],
          },
        ],
      },
    });

    expect(renderWarningTriage(report)).toContain("f.md");
    expect(renderWarningTriage(report, { maxExamples: 5 })).not.toContain("f.md");
    expect(renderWarningTriage(report, { maxExamples: 5 })).toContain("e.md");
  });

  it("reports missing stats instead of throwing", () => {
    expect(renderWarningTriage(makeReport())).toBe("- None.");
  });
});

describe("renderEngineeringOps", () => {
  it("collects the quality snapshot, review summaries, and the generated artifact list", () => {
    const note = makeNote({
      path: "/vault/notes/a.md",
      noteType: "research",
      updated: "2026-06-01",
    });
    const item = makeRiskItem({ note, text: "A risk worth flagging.", source: "section_line" });
    const pack = makePack({
      risks: [item],
      report: {
        filesScanned: 12,
        markdownFilesParsed: 9,
        filesSkipped: 3,
        parseErrors: [{ path: "bad.md", message: "boom" }],
        warnings: ["a.md: Missing updated field"],
        generatedFiles: [],
        sourceCoverage: { notesWithUpdated: 8, notesMissingUpdated: 1, noteTypes: { research: 9 } },
        provenanceStats: {
          averageScore: 70,
          strongItems: 2,
          moderateItems: 1,
          weakItems: 0,
          byLevel: { strong: 2, moderate: 1 },
        },
        confidenceStats: { averageScore: 60, highItems: 1, lowItems: 0, byLevel: { high: 1 } },
        contradictionStats: { totalCandidates: 3, reviewItems: 1, watchItems: 2, bySignal: {} },
      },
    });

    const rendered = renderEngineeringOps(pack);

    expect(rendered).toContain("# Engineering Ops: Research Vault");
    expect(rendered).toContain("- Files scanned: 12");
    expect(rendered).toContain("- Parse errors: 1");
    expect(rendered).toContain("## Warning Triage");
    expect(rendered).toContain("## Source Provenance");
    expect(rendered).toContain("- Average score: 70");
    expect(rendered).toContain("## Confidence Metadata");
    expect(rendered).toContain("- Average score: 60");
    expect(rendered).toContain("## Contradiction Candidates");
    expect(rendered).toContain("- Candidates: 3");
    expect(rendered).toContain("## Generated Artifacts");
    expect(rendered).toContain("- ENGINEERING_OPS.md");
    expect(rendered).toContain("- MEMORY_DIFF.md");
    expect(rendered).toContain("- COMPILE_REPORT.json");
    expect(rendered).toContain("## Release Gate Notes");
  });
});

describe("renderTeamMemory", () => {
  it("surfaces the current objective, active work, and review queues for a handoff", () => {
    const note = makeNote({
      path: "/vault/notes/a.md",
      noteType: "project",
      updated: "2026-06-01",
    });
    const activeAction = makeItem({
      note,
      text: "Ship the handoff report.",
      source: "task_list",
      kind: "action",
      status: "open",
    });
    const doneAction = makeItem({
      note,
      text: "Already finished this one.",
      source: "task_list",
      kind: "action",
      status: "done",
    });
    const decision = makeItem({
      note,
      text: "Adopt the new report format.",
      source: "explicit_marker",
      kind: "decision",
    });
    const risk = makeItem({
      note,
      text: "Reports could go stale.",
      source: "section_line",
      kind: "risk",
    });
    const question = makeItem({
      note,
      text: "Who owns weekly review?",
      source: "section_line",
      kind: "question",
    });
    const staleItem = { ...activeAction, status: "stale" as const };

    const pack = makePack({
      actions: [activeAction, doneAction],
      decisions: [decision],
      risks: [risk],
      questions: [question],
      staleItems: [staleItem],
      report: {
        filesScanned: 5,
        markdownFilesParsed: 5,
        filesSkipped: 0,
        parseErrors: [],
        warnings: [],
        generatedFiles: [],
        provenanceStats: {
          averageScore: 80,
          strongItems: 3,
          moderateItems: 0,
          weakItems: 1,
          byLevel: {},
        },
        contradictionStats: { totalCandidates: 2, reviewItems: 1, watchItems: 1, bySignal: {} },
      },
    });

    const rendered = renderTeamMemory(pack);

    expect(rendered).toContain("# Team Memory: Research Vault");
    expect(rendered).toContain("## Current Objective");
    expect(rendered).toContain("## Active Work");
    expect(rendered).toContain("Ship the handoff report.");
    // A finished action is not "active work".
    expect(rendered.split("## Active Work")[1]?.split("## Decisions")[0]).not.toContain(
      "Already finished this one.",
    );
    expect(rendered).toContain("## Decisions");
    expect(rendered).toContain("Adopt the new report format.");
    expect(rendered).toContain("## Risks");
    expect(rendered).toContain("Reports could go stale.");
    expect(rendered).toContain("## Open Questions");
    expect(rendered).toContain("Who owns weekly review?");
    expect(rendered).toContain("## Stale Follow-up");
    expect(rendered).toContain("## Review Queues");
    expect(rendered).toContain("- Weak provenance items: 1");
    expect(rendered).toContain("- Contradiction candidates: 2");
    expect(rendered).toContain("## Handoff Notes");
  });

  it("falls back to zero counts in the review queues when stats are missing", () => {
    const pack = makePack();

    const rendered = renderTeamMemory(pack);

    expect(rendered).toContain("- Low confidence items: 0");
    expect(rendered).toContain("- Weak provenance items: 0");
    expect(rendered).toContain("- Contradiction candidates: 0");
  });
});
