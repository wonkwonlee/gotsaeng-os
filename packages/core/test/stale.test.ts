import { describe, expect, it } from "vitest";

import { extractItems } from "../src/extractor";
import { parseMarkdown } from "../src/parser";
import { detectStaleItems } from "../src/stale";

describe("stale detector", () => {
  it("marks old updated items as stale with a deterministic clock", () => {
    const note = parseMarkdown(
      [
        "---",
        "updated: 2026-01-01",
        "---",
        "",
        "- [ ] action: Revisit old weekly-review actions.",
        "- fact: Old fact."
      ].join("\n"),
      "/vault/logs/weekly.md",
      "/vault"
    );
    const items = extractItems(note);

    const stale = detectStaleItems({
      notes: [note],
      items,
      staleDays: 90,
      dateProvider: () => new Date("2026-06-06T00:00:00.000Z")
    });

    expect(stale).toHaveLength(2);
    expect(stale.every((item) => item.status === "stale")).toBe(true);
  });

  it("does not mark missing updated dates stale automatically", () => {
    const note = parseMarkdown("- [ ] action: Missing date action.", "/vault/missing.md", "/vault");
    const stale = detectStaleItems({
      notes: [note],
      items: extractItems(note),
      staleDays: 90,
      dateProvider: () => new Date("2026-06-06T00:00:00.000Z")
    });

    expect(stale).toEqual([]);
  });
});
