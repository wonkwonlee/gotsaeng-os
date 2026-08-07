import { describe, expect, it } from "vitest";

import { buildBacklinkIndex, extractSourceLinks } from "../src/source-links";

describe("Obsidian source links", () => {
  it("extracts source notes from generated Markdown metadata and wikilinks", () => {
    const links = extractSourceLinks(
      [
        "- Follow up ([[10_Wiki/source-note.md|Source Note]]; status: open)",
        "- Risk item (source: 20_Projects/project plan.md; status: unknown)",
        "- Again (source: 20_Projects/project plan.md; status: active)",
      ].join("\n"),
    );

    expect(links).toEqual([
      {
        path: "20_Projects/project plan.md",
        label: "20_Projects/project plan.md",
        count: 2,
      },
      {
        path: "10_Wiki/source-note.md",
        label: "Source Note",
        count: 1,
      },
    ]);
  });

  it("extracts source notes from context manifest JSON previews", () => {
    const links = extractSourceLinks(
      JSON.stringify({
        items: [
          { sourcePath: "01_Capture/inbox/갓생메이커-Health.md" },
          { sourcePath: "40_Research/conversations/ira-rebalancing-2026-06-03.chat.md" },
        ],
      }),
    );

    expect(links.map((link) => link.path)).toEqual([
      "01_Capture/inbox/갓생메이커-Health.md",
      "40_Research/conversations/ira-rebalancing-2026-06-03.chat.md",
    ]);
  });

  it("excludes generated output artifacts from source navigation", () => {
    const links = extractSourceLinks(
      [
        "- [[.gotsaeng/context-pack/PROJECT_CONTEXT.md|Project Context]]",
        "- [[REPORT_HUB.md|Report Hub]]",
        "- Source note: [[10_Wiki/source-note.md|Source Note]]",
      ].join("\n"),
      { outputFolder: ".gotsaeng/context-pack" },
    );

    expect(links).toEqual([
      {
        path: "10_Wiki/source-note.md",
        label: "Source Note",
        count: 1,
      },
    ]);
  });
});

describe("buildBacklinkIndex", () => {
  it("aggregates a source note's references across every generated report", () => {
    const backlinks = buildBacklinkIndex({
      "REPORT_HUB.md": "- Follow up ([[10_Wiki/source-note.md|Source Note]]; status: open)",
      "ACTION_BACKLOG.md": [
        "- Again ([[10_Wiki/source-note.md|Source Note]])",
        "- Once ([[10_Wiki/source-note.md|Source Note]])",
      ].join("\n"),
    });

    expect(backlinks).toEqual([
      {
        path: "10_Wiki/source-note.md",
        label: "Source Note",
        totalCount: 3,
        reports: [
          { fileName: "ACTION_BACKLOG.md", label: "Action Backlog", count: 2 },
          { fileName: "REPORT_HUB.md", label: "Report Hub", count: 1 },
        ],
      },
    ]);
  });

  it("ranks notes by total reference count and ignores JSON artifacts and missing files", () => {
    const backlinks = buildBacklinkIndex({
      "REPORT_HUB.md": "- [[10_Wiki/rare-note.md|Rare Note]]",
      "ACTION_BACKLOG.md": [
        "- [[10_Wiki/popular-note.md|Popular Note]]",
        "- [[10_Wiki/popular-note.md|Popular Note]]",
      ].join("\n"),
      "COMPILE_REPORT.json": JSON.stringify({ items: [{ sourcePath: "10_Wiki/rare-note.md" }] }),
    });

    expect(backlinks.map((entry) => entry.path)).toEqual([
      "10_Wiki/popular-note.md",
      "10_Wiki/rare-note.md",
    ]);
  });

  it("returns an empty index when no generated report content is available", () => {
    expect(buildBacklinkIndex({})).toEqual([]);
  });
});
