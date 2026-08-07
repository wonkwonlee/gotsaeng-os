import { describe, expect, it } from "vitest";

import { classifyNoteType } from "../src/classifier";

describe("classifier", () => {
  it("prefers frontmatter type when valid", () => {
    expect(classifyNoteType("misc/file.md", { type: "decision" })).toBe("decision");
  });

  it("maps common vault note aliases to research notes", () => {
    expect(classifyNoteType("some/path.md", { type: "memo" })).toBe("research");
    expect(classifyNoteType("some/path.md", { type: "note" })).toBe("research");
  });

  it("infers note types from paths and filenames", () => {
    expect(classifyNoteType("01_projects/gotsaeng-os.md")).toBe("project");
    expect(classifyNoteType("02_decisions/plugin-vs-framework.md")).toBe("decision");
    expect(classifyNoteType("03_logs/weekly-review.md")).toBe("weekly-review");
    expect(classifyNoteType("04_research/context.md")).toBe("research");
    expect(classifyNoteType("00_inbox/raw-chat-export.md")).toBe("chat-export");
    expect(classifyNoteType("templates/project.md")).toBe("template");
    expect(classifyNoteType("scratch/random.md")).toBe("unknown");
  });

  it("infers research from meeting and interview folders", () => {
    expect(classifyNoteType("meetings/2026-01-standup.md")).toBe("research");
    expect(classifyNoteType("interviews/candidate-x.md")).toBe("research");
  });
});

// classifyNoteType is a flat if-chain over path segments, so when a path matches
// more than one rule the winner is decided purely by the order the checks appear
// in. These cases pin the current precedence: they document behaviour rather than
// endorse it, so a reorder of that chain shows up as a failing test instead of a
// silent reclassification of someone's vault.
describe("classifier path precedence", () => {
  it("lets templates win over every other folder segment", () => {
    expect(classifyNoteType("templates/projects/new-project.md")).toBe("template");
    expect(classifyNoteType("templates/research/study.md")).toBe("template");
    expect(classifyNoteType("templates/daily/today.md")).toBe("template");
  });

  it("lets daily win over research", () => {
    expect(classifyNoteType("research/daily/2026-01-02.md")).toBe("daily");
  });

  it("lets projects win over meetings and interviews", () => {
    // Nested meeting notes under a project folder classify as `project`, because
    // the projects check runs before the meetings/interviews check.
    expect(classifyNoteType("01_projects/meetings/kickoff.md")).toBe("project");
    expect(classifyNoteType("01_projects/interviews/user-3.md")).toBe("project");
  });

  it("lets decisions win over projects", () => {
    expect(classifyNoteType("01_projects/decisions/adopt-pnpm.md")).toBe("decision");
  });

  it("treats a weekly filename as a weekly review outside logs too", () => {
    expect(classifyNoteType("03_logs/weekly-review-2026-W23.md")).toBe("weekly-review");
    expect(classifyNoteType("somewhere/weekly-notes.md")).toBe("weekly-review");
  });

  it("requires both inbox and a chat filename for chat-export", () => {
    expect(classifyNoteType("00_inbox/raw-chat-export.md")).toBe("chat-export");
    // `chat` alone, outside an inbox folder, is not enough.
    expect(classifyNoteType("archive/raw-chat-export.md")).toBe("unknown");
  });

  it("classifies by path case-insensitively", () => {
    expect(classifyNoteType("01_Projects/GotSaeng-OS.md")).toBe("project");
    expect(classifyNoteType("Templates/Project.md")).toBe("template");
  });
});
