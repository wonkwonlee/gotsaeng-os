import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  compareStrings,
  normalizePath,
  titleFromFilename,
  toRelativeSourcePath,
} from "../src/utils/path";

describe("normalizePath", () => {
  it("converts platform path separators to forward slashes", () => {
    const withSep = ["notes", "project.md"].join(path.sep);
    expect(normalizePath(withSep)).toBe("notes/project.md");
  });

  it("leaves an already-forward-slash path untouched on posix", () => {
    if (path.sep === "/") {
      expect(normalizePath("notes/project.md")).toBe("notes/project.md");
    }
  });
});

describe("toRelativeSourcePath", () => {
  it("returns a forward-slash path relative to the given root", () => {
    const root = path.join("/vault");
    const file = path.join("/vault", "notes", "project.md");
    expect(toRelativeSourcePath(root, file)).toBe("notes/project.md");
  });
});

describe("titleFromFilename", () => {
  it("replaces separators with spaces and title-cases each word", () => {
    expect(titleFromFilename("weekly-review_notes.md")).toBe("Weekly Review Notes");
  });

  it("collapses repeated separators and trims whitespace", () => {
    expect(titleFromFilename("--already___spaced--.md")).toBe("Already Spaced");
  });

  it("leaves a single-word filename capitalized", () => {
    expect(titleFromFilename("project.md")).toBe("Project");
  });
});

describe("compareStrings", () => {
  it("orders by raw UTF-16 code point, not locale-aware collation", () => {
    // This is load-bearing for deterministic output ordering (report/export
    // sorting all key on this). A future refactor might be tempted to swap
    // it for String.prototype.localeCompare — do not: locale collation is
    // environment-dependent and disagrees with code-point order below.
    expect(compareStrings("café", "caff")).toBe(1);
    expect("café".localeCompare("caff")).toBe(-1); // sanity: locale disagrees

    expect(compareStrings("Z", "a")).toBe(-1);
    expect("Z".localeCompare("a")).toBe(1); // sanity: locale disagrees
  });

  it("sorts Korean strings by code point, matching numeric UTF-16 order", () => {
    const sorted = ["다", "가", "나"].sort(compareStrings);
    expect(sorted).toEqual(["가", "나", "다"]);
  });

  it("returns 0 for equal strings and is antisymmetric for unequal ones", () => {
    expect(compareStrings("same", "same")).toBe(0);
    expect(compareStrings("a", "b")).toBe(-1);
    expect(compareStrings("b", "a")).toBe(1);
  });
});
