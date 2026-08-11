import { describe, expect, it } from "vitest";

import {
  DEFAULT_HANDOFF_SECTIONS,
  LLM_HANDOFF_FILE,
  renderLlmHandoff,
  titleFromGeneratedFileName,
} from "../src/exporters/handoff-exporter";
import type { ContextPack } from "../src/schemas/context";

// Only projectName/generatedAt are read by the renderer; cast keeps the fixture small.
const pack = { projectName: "Demo", generatedAt: "2026-08-11" } as ContextPack;

const files: Partial<Record<string, string>> = {
  "PROJECT_CONTEXT.md": "# Project Context: Demo\n\nBody A",
  "MEMORY_SNAPSHOT.md": "# Memory Snapshot\n\nBody B",
  "DECISION_LOG.md": "# Decision Log\n\nBody C",
  "ACTION_BACKLOG.md": "# Action Backlog\n\nBody D",
  "RISK_REGISTER.md": "# Risk Register\n\nBody E",
  "OPEN_QUESTIONS.md": "# Open Questions\n\nBody F",
};

describe("renderLlmHandoff", () => {
  it("renders the default six sections with title-cased headings", () => {
    const out = renderLlmHandoff(pack, files);
    expect(out).toContain("# LLM Handoff: Demo");
    expect(out).toContain("Generated: 2026-08-11");
    expect(out).toContain(
      "This handoff is local-only generated context. It does not include AI-generated analysis.",
    );
    for (const heading of [
      "## Project Context",
      "## Memory Snapshot",
      "## Decision Log",
      "## Action Backlog",
      "## Risk Register",
      "## Open Questions",
    ]) {
      expect(out).toContain(heading);
    }
    // First-line titles of the source files are stripped.
    expect(out).not.toContain("# Project Context: Demo");
    expect(out).toContain("Body A");
  });

  it("honors a selective sections option and preserves order", () => {
    const out = renderLlmHandoff(pack, files, {
      sections: ["DECISION_LOG.md", "RISK_REGISTER.md", "OPEN_QUESTIONS.md"],
    });
    expect(out).toContain("## Decision Log");
    expect(out).toContain("## Risk Register");
    expect(out).toContain("## Open Questions");
    expect(out).not.toContain("## Project Context");
    expect(out.indexOf("## Decision Log")).toBeLessThan(out.indexOf("## Risk Register"));
  });

  it("renders a missing section body as empty rather than throwing", () => {
    const out = renderLlmHandoff(pack, {}, { sections: ["DECISION_LOG.md"] });
    expect(out).toContain("## Decision Log");
  });

  it("exposes stable constants", () => {
    expect(LLM_HANDOFF_FILE).toBe("LLM_HANDOFF.md");
    expect(DEFAULT_HANDOFF_SECTIONS).toEqual([
      "PROJECT_CONTEXT.md",
      "MEMORY_SNAPSHOT.md",
      "DECISION_LOG.md",
      "ACTION_BACKLOG.md",
      "RISK_REGISTER.md",
      "OPEN_QUESTIONS.md",
    ]);
    expect(titleFromGeneratedFileName("STALE_CONTEXT.md")).toBe("Stale Context");
  });
});
