import { describe, expect, it } from "vitest";

import { classifyNoteType } from "../src/classifier";

describe("classifier", () => {
  it("prefers frontmatter type when valid", () => {
    expect(classifyNoteType("misc/file.md", { type: "decision" })).toBe("decision");
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
});
