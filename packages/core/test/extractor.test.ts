import { describe, expect, it } from "vitest";

import { extractItems, MAX_SECTION_LINE_ITEMS_PER_HEADING } from "../src/extractor";
import { parseMarkdown } from "../src/parser";

describe("extractor", () => {
  it("extracts supported marker kinds", () => {
    const note = parseMarkdown(
      [
        "# Source Note",
        "- fact: GotSaeng OS should be local-first.",
        "- decision: Build the CLI before the Obsidian plugin.",
        "- action: Implement Markdown scanner.",
        "- risk: Generic AI note summarization may be absorbed by foundation models.",
        "- assumption: Early users are likely Obsidian power users.",
        "- question: Should the first plugin support Dataview?",
        "- insight: The real product is context infrastructure."
      ].join("\n"),
      "/vault/source.md",
      "/vault"
    );

    expect(extractItems(note).map((item) => item.kind)).toEqual([
      "action",
      "assumption",
      "decision",
      "fact",
      "insight",
      "question",
      "risk"
    ]);
  });

  it("normalizes TODO markers to action", () => {
    const note = parseMarkdown("- todo: Add tests for YAML parsing.", "/vault/todo.md", "/vault");

    expect(extractItems(note)).toMatchObject([
      {
        kind: "action",
        text: "Add tests for YAML parsing."
      }
    ]);
  });

  it("warns when extracted item text is truncated", () => {
    const longText = "A".repeat(500);
    const note = parseMarkdown(`- fact: ${longText}`, "/vault/long.md", "/vault");
    const [item] = extractItems(note);

    expect(item).toBeDefined();
    expect(item?.text.length).toBeLessThan(longText.length);
    expect(item?.text.endsWith("...")).toBe(true);

    const warnings = item?.confidence?.warnings ?? [];
    expect(warnings.some((warning) => warning.includes("truncated"))).toBe(true);
    // the warning surfaces the source path and the original length
    const sourcePath = item?.sourcePath ?? "";
    expect(sourcePath).not.toEqual("");
    expect(warnings.some((warning) => warning.includes(sourcePath))).toBe(true);
    expect(warnings.some((warning) => warning.includes("500"))).toBe(true);
  });

  it("does not warn about truncation for normal-length text", () => {
    const note = parseMarkdown("- fact: GotSaeng OS is local-first.", "/vault/ok.md", "/vault");
    const [item] = extractItems(note);

    const warnings = item?.confidence?.warnings ?? [];
    expect(warnings.some((warning) => warning.includes("truncated"))).toBe(false);
  });

  it("infers task-list status", () => {
    const note = parseMarkdown(
      ["- [ ] action: Add compiler tests.", "- [x] todo: Write README quickstart."].join("\n"),
      "/vault/tasks.md",
      "/vault"
    );

    const items = extractItems(note);
    expect(items.find((item) => item.text === "Add compiler tests.")?.status).toBe("open");
    expect(items.find((item) => item.text === "Write README quickstart.")?.status).toBe("done");
  });

  it("infers priority from explicit and shorthand markers", () => {
    const note = parseMarkdown(
      ["- action: Ship compiler. priority: high", "Risk: Scope can creep. !medium"].join("\n"),
      "/vault/priorities.md",
      "/vault"
    );

    const items = extractItems(note);
    expect(items.find((item) => item.kind === "action")?.priority).toBe("high");
    expect(items.find((item) => item.kind === "risk")?.priority).toBe("medium");
  });

  it("extracts plain Obsidian task lists as actions with section context", () => {
    const note = parseMarkdown(
      ["# TODO", "", "### Personal", "- [ ] GitHub profile update ⏫", "- [x] Write release notes"].join("\n"),
      "/vault/02_Daily/TODO.md",
      "/vault"
    );

    const items = extractItems(note);
    expect(items).toMatchObject([
      {
        kind: "action",
        text: "Personal: GitHub profile update",
        status: "open",
        priority: "high"
      },
      {
        kind: "action",
        text: "Personal: Write release notes",
        status: "done"
      }
    ]);
  });

  it("extracts numbered task lists with explicit markers", () => {
    const note = parseMarkdown(
      ["1. [ ] action: Deploy the app.", "2. [x] todo: Verify the release."].join("\n"),
      "/vault/tasks.md",
      "/vault"
    );

    expect(extractItems(note)).toMatchObject([
      {
        kind: "action",
        text: "Deploy the app.",
        status: "open"
      },
      {
        kind: "action",
        text: "Verify the release.",
        status: "done"
      }
    ]);
  });

  it("extracts numbered task lists without explicit markers", () => {
    const note = parseMarkdown(
      "1. [ ] Deploy the app.",
      "/vault/02_Daily/TODO.md",
      "/vault"
    );

    expect(extractItems(note)).toMatchObject([
      {
        kind: "action",
        text: "Deploy the app.",
        status: "open"
      }
    ]);
  });

  it("extracts summary paragraphs and key-point headings as insights", () => {
    const note = parseMarkdown(
      [
        "# Wiki",
        "",
        "## Summary",
        "",
        "This page captures a durable operating pattern for long-running context.",
        "",
        "## Key Points",
        "",
        "### 1. Context needs source-aware recovery",
        "The compiler should keep source paths visible."
      ].join("\n"),
      "/vault/10_Wiki/pattern.md",
      "/vault"
    );

    expect(extractItems(note).filter((item) => item.kind === "insight")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "This page captures a durable operating pattern for long-running context."
        }),
        expect.objectContaining({
          text: "Context needs source-aware recovery"
        }),
        expect.objectContaining({
          text: "The compiler should keep source paths visible."
        })
      ])
    );
  });

  it("caps inferred section_line items per heading", () => {
    const bullets = Array.from(
      { length: 30 },
      (_unused, index) => `- Inferred risk number ${index + 1} about the research direction.`
    );
    const note = parseMarkdown(
      ["# Research Note", "", "## Risks", "", ...bullets].join("\n"),
      "/vault/30_Research/risks.md",
      "/vault"
    );

    const risks = extractItems(note).filter((item) => item.kind === "risk");
    expect(risks.length).toBe(MAX_SECTION_LINE_ITEMS_PER_HEADING);
  });

  it("applies the section_line cap per heading independently", () => {
    const firstBullets = Array.from(
      { length: 30 },
      (_unused, index) => `- Risk A number ${index + 1} for the first section.`
    );
    const secondBullets = Array.from(
      { length: 30 },
      (_unused, index) => `- Risk B number ${index + 1} for the second section.`
    );
    const note = parseMarkdown(
      [
        "# Research Note",
        "",
        "## Risks",
        "",
        ...firstBullets,
        "",
        "## Additional Risks",
        "",
        ...secondBullets
      ].join("\n"),
      "/vault/30_Research/multi.md",
      "/vault"
    );

    const risks = extractItems(note).filter((item) => item.kind === "risk");
    expect(risks.length).toBe(MAX_SECTION_LINE_ITEMS_PER_HEADING * 2);
  });

  it("never caps explicit marker items even beyond the section cap", () => {
    const englishMarkers = Array.from(
      { length: 18 },
      (_unused, index) => `- risk: Explicit risk number ${index + 1}.`
    );
    const koreanMarkers = Array.from(
      { length: 18 },
      (_unused, index) => `- 위험: 명시적 위험 ${index + 1}.`
    );
    const note = parseMarkdown(
      ["# Research Note", "", "## Risks", "", ...englishMarkers, ...koreanMarkers].join("\n"),
      "/vault/30_Research/explicit.md",
      "/vault"
    );

    const risks = extractItems(note).filter((item) => item.kind === "risk");
    expect(risks.length).toBe(englishMarkers.length + koreanMarkers.length);
    expect(risks.length).toBeGreaterThan(MAX_SECTION_LINE_ITEMS_PER_HEADING);
  });
});
