import { describe, expect, it } from "vitest";

import { toVaultWikiLink } from "../src/reports";
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

// toVaultWikiLink (src/reports.ts) is the only writer of the wikilinks
// extractSourceLinks reads back, so the two have to agree about the characters
// Obsidian reserves inside a link. They didn't: only `|` was handled, and by
// replacing it with a space — which produced a link pointing at a path that
// does not exist, and one this extractor could not recover the original of.
describe("wikilink round trip", () => {
  const RESERVED_PATHS = [
    "10_Wiki/a|b.md",
    "10_Wiki/a#b.md",
    "10_Wiki/a[b].md",
    "10_Wiki/a^b.md",
    "10_Wiki/every [reserved] #char|here^too.md",
    // A real file whose name merely *looks* percent-encoded. Until `%` was
    // itself escaped, this path went into the link untouched and came back out
    // as "10_Wiki/a[b.md" — a different file.
    "10_Wiki/a%5Bb.md",
    "10_Wiki/a%b.md",
    "10_Wiki/a%25b.md",
    "10_Wiki/100% done.md",
    "10_Wiki/50%off & 100%.md",
    "10_Wiki/a%[b.md",
    "10_Wiki/mixed %5B with [real] #reserved|chars^.md",
  ];

  it.each(RESERVED_PATHS)("recovers %s through toVaultWikiLink", (sourcePath) => {
    const links = extractSourceLinks(`- Item (${toVaultWikiLink(sourcePath, "Label")})`);

    expect(links).toHaveLength(1);
    expect(links[0]?.path).toBe(sourcePath);
    expect(links[0]?.label).toBe("Label");
  });

  it("leaves a path with no reserved characters byte-for-byte unchanged", () => {
    expect(toVaultWikiLink("10_Wiki/source-note.md", "Source Note")).toBe(
      "[[10_Wiki/source-note.md|Source Note]]",
    );
  });

  it("escapes a percent sign only when it already spells one of this encoder's own escape codes", () => {
    // The collision case: "%5B" would otherwise be decoded back into "[" and
    // name a different file, so the "%" is escaped and the literal "5B" behind
    // it stays literal on the way back.
    expect(toVaultWikiLink("10_Wiki/a%5Bb.md", "Label")).toBe("[[10_Wiki/a%255Bb.md|Label]]");
    expect(toVaultWikiLink("10_Wiki/a%25b.md", "Label")).toBe("[[10_Wiki/a%2525b.md|Label]]");
  });

  it("leaves an ordinary percent sign byte-identical so the link still opens in Obsidian", () => {
    // Obsidian does not percent-decode a wikilink target, so an escaped "%"
    // is a link that resolves to nothing. Everything but the six-code
    // collision above is therefore passed through untouched — see
    // WIKILINK_RESERVED in src/reports.ts.
    expect(toVaultWikiLink("10_Wiki/a%b.md", "Label")).toBe("[[10_Wiki/a%b.md|Label]]");
    expect(toVaultWikiLink("10_Wiki/100% done.md", "Label")).toBe("[[10_Wiki/100% done.md|Label]]");
    // "%" followed by hex digits that are not one of the six codes is still
    // ordinary: only "%25", "%5B", "%5D", "%7C", "%23" and "%5E" collide.
    expect(toVaultWikiLink("10_Wiki/a%5Ab.md", "Label")).toBe("[[10_Wiki/a%5Ab.md|Label]]");
    // And a "%" immediately before a character that IS escaped stays as it is:
    // the escape it emits brings its own "%", so the two never merge into one
    // decodable sequence.
    expect(toVaultWikiLink("10_Wiki/a%[b.md", "Label")).toBe("[[10_Wiki/a%%5Bb.md|Label]]");
  });

  it("strips the characters that would terminate the link early out of the label", () => {
    // The label is display text, not an identity: it is sanitized rather than
    // encoded, so a reader never sees "%5D" in a heading.
    expect(toVaultWikiLink("10_Wiki/note.md", "a]b|c")).toBe("[[10_Wiki/note.md|a b c]]");
  });

  it("does not decode a percent sequence in a path that never went through the encoder", () => {
    // Only the wikilink pattern decodes; a `source:` line carries the path
    // verbatim, so a literal "%5B" in one is part of the file name.
    const links = extractSourceLinks("- Item (source: 10_Wiki/literal%5Bpercent.md; status: open)");

    expect(links[0]?.path).toBe("10_Wiki/literal%5Bpercent.md");
  });
});
