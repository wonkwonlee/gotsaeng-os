import { describe, expect, it } from "vitest";

import { createDeterministicId, normalizeTextForId } from "../src/utils/hash";

describe("normalizeTextForId", () => {
  it("trims leading/trailing whitespace and collapses internal runs to a single space", () => {
    expect(normalizeTextForId("  Ship   the   feature.  ")).toBe("ship the feature.");
  });

  it("collapses newlines and tabs as whitespace", () => {
    expect(normalizeTextForId("Line one\n\tLine two")).toBe("line one line two");
  });

  it("lowercases the text", () => {
    expect(normalizeTextForId("SHOUTING TEXT")).toBe("shouting text");
  });
});

describe("createDeterministicId", () => {
  it("returns the same id for the same input parts every time", () => {
    const parts = ["note.md", "action", "Ship the feature."];
    expect(createDeterministicId(parts)).toBe(createDeterministicId([...parts]));
  });

  it("is a 16-character lowercase hex string", () => {
    const id = createDeterministicId(["note.md", "fact", "text"]);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("treats normalization-equivalent text as the same id (whitespace/case-insensitive)", () => {
    const a = createDeterministicId(["note.md", "action", "  Ship the Feature.  "]);
    const b = createDeterministicId(["note.md", "action", "ship the feature."]);
    expect(a).toBe(b);
  });

  it("produces different ids for different inputs", () => {
    const a = createDeterministicId(["note.md", "action", "Ship the feature."]);
    const b = createDeterministicId(["note.md", "action", "Ship a different feature."]);
    expect(a).not.toBe(b);
  });

  it("does not collide across the part boundary when concatenation would otherwise match", () => {
    // parts.join("|") after normalization means ["ab", "c"] and ["a", "bc"]
    // must stay distinct despite superficially "joining" to the same text.
    const a = createDeterministicId(["ab", "c"]);
    const b = createDeterministicId(["a", "bc"]);
    expect(a).not.toBe(b);
  });
});
