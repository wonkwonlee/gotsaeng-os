import { describe, expect, it } from "vitest";

import { scoreExtractionConfidence, type ExtractionConfidenceSource } from "../src/confidence";
import {
  REGISTER_ITEM_CAP,
  RISK_REGISTER_CAP,
  renderActionBacklog,
  renderMemorySnapshot,
  renderOpenQuestions,
  renderRiskRegister
} from "../src/exporters/markdown-exporter";
import type { ContextPack, ExtractedItem } from "../src/schemas/context";
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
    raw: ""
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
    tags: [] as string[]
  };

  return {
    ...base,
    confidence: scoreExtractionConfidence(input.note, base, input.source)
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
      generatedFiles: []
    },
    ...overrides
  };
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
      updated: "2026-06-01"
    });

    const explicitTexts = Array.from({ length: 5 }, (_unused, index) => `Explicit risk ${index + 1}`);
    const sectionTexts = Array.from({ length: 250 }, (_unused, index) => `Section risk ${index + 1}`);

    const sectionRisks = sectionTexts.map((text) =>
      makeRiskItem({ note: strongNote, text, source: "section_line" })
    );
    const explicitRisks = explicitTexts.map((text) =>
      makeRiskItem({ note: weakNote, text, source: "explicit_marker" })
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
    const sectionPresent = sectionTexts.filter((text) => new RegExp(`${text}\\b`).test(rendered)).length;
    expect(sectionPresent).toBe(RISK_REGISTER_CAP - explicitTexts.length);
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
      updated: "2026-06-01"
    });
    const explicitTexts = Array.from({ length: 5 }, (_unused, i) => `Explicit ${kind} ${i + 1}`);
    const sectionTexts = Array.from({ length: 250 }, (_unused, i) => `Section ${kind} ${i + 1}`);
    const items = [
      ...sectionTexts.map((text) => makeItem({ note: strongNote, text, source: "section_line", kind, status })),
      ...explicitTexts.map((text) => makeItem({ note: weakNote, text, source: "explicit_marker", kind, status }))
    ];
    return { explicitTexts, sectionTexts, items };
  }

  function assertCapped(rendered: string, explicitTexts: string[], sectionTexts: string[]) {
    for (const text of explicitTexts) {
      expect(rendered).toContain(text);
    }
    expect(rendered).toContain("more items omitted");
    const sectionPresent = sectionTexts.filter((text) => new RegExp(`${text}\\b`).test(rendered)).length;
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
    const note = makeNote({ path: "/vault/notes/a.md", noteType: "research", updated: "2026-06-01" });
    const items = Array.from({ length: 3 }, (_unused, i) =>
      makeItem({ note, text: `Question ${i + 1}`, source: "section_line", kind: "question", status: "open" })
    );
    const rendered = renderOpenQuestions(makePack({ questions: items }));

    expect(rendered).not.toContain("more items omitted");
    for (const item of items) {
      expect(rendered).toContain(item.text);
    }
  });
});
