import type { CompileReport } from "@gotsaeng/core";
import type { WorkspaceLeaf } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_OUTPUT_ARTIFACT } from "../src/artifacts";
import { DEFAULT_SETTINGS, type GotSaengPluginSettings } from "../src/settings";
import {
  GOTSAENG_REPORT_VIEW_TYPE,
  GotSaengReportHubView,
  type ReportHubController,
} from "../src/view";
import { createFakeApp } from "./mocks/fake-app";
import { type FakeElement, renderedMarkdown, resetObsidianMocks } from "./mocks/obsidian";

function createFakeController(overrides: Partial<ReportHubController> = {}): ReportHubController {
  return {
    settings: { ...DEFAULT_SETTINGS } as GotSaengPluginSettings,
    selectedOutputFileName: DEFAULT_OUTPUT_ARTIFACT.fileName,
    compileContextPackCommand: vi.fn(async () => {}),
    generateWeeklyReviewCommand: vi.fn(async () => {}),
    exportLlmHandoffCommand: vi.fn(async () => {}),
    validateVaultSchemaCommand: vi.fn(async () => {}),
    setSelectedOutputFileName: vi.fn(),
    readOutputFileByName: vi.fn(async () => null),
    openOutputFileByName: vi.fn(async () => {}),
    openSourceFileByPath: vi.fn(async () => {}),
    readCurrentCompileReport: vi.fn(async () => null),
    ...overrides,
  };
}

function createView(controller: ReportHubController): GotSaengReportHubView {
  const fakeApp = createFakeApp("/vault");
  const leaf = { app: fakeApp } as unknown as WorkspaceLeaf;
  return new GotSaengReportHubView(leaf, controller);
}

// `ItemView.contentEl` is declared as the real DOM `HTMLElement` on the
// ambient (type-only) "obsidian" module main.ts/view.ts type-check against.
// At test runtime it is actually a `FakeElement` from ./mocks/obsidian.ts
// (aliased in for "obsidian"; see root vitest.config.ts), so tests read it
// through this narrowing helper instead of scattering casts everywhere.
function contentElOf(view: GotSaengReportHubView): FakeElement {
  return view.contentEl as unknown as FakeElement;
}

const MINIMAL_REPORT: CompileReport = {
  filesScanned: 3,
  markdownFilesParsed: 2,
  filesSkipped: 1,
  parseErrors: [],
  warnings: ["Missing updated field: note.md"],
  generatedFiles: [],
};

const FULL_REPORT: CompileReport = {
  ...MINIMAL_REPORT,
  extractionStats: {
    totalItems: 5,
    byKind: {},
    byStatus: {},
    notesWithItems: 2,
    notesWithoutItems: 0,
  },
  sourceCoverage: { noteTypes: {}, notesWithUpdated: 1, notesMissingUpdated: 1 },
  provenanceStats: {
    averageScore: 80,
    byLevel: {},
    weakItems: 1,
    moderateItems: 1,
    strongItems: 3,
  },
  confidenceStats: {
    averageScore: 70,
    byLevel: {},
    lowItems: 2,
    highItems: 3,
  },
  contradictionStats: {
    totalCandidates: 1,
    bySignal: {},
    reviewItems: 1,
    watchItems: 0,
  },
};

beforeEach(() => {
  resetObsidianMocks();
});

describe("GotSaengReportHubView render", () => {
  it("shows an empty-state message when no compile report exists yet", async () => {
    const controller = createFakeController({ readCurrentCompileReport: vi.fn(async () => null) });
    const view = createView(controller);

    await view.render();

    const stats = contentElOf(view).findByClass("gotsaeng-os-stats");
    expect(stats?.text === undefined).toBe(true);
    const emptyMessage = stats?.children.find((child) =>
      child.text?.includes("No compile report found yet"),
    );
    expect(emptyMessage).toBeDefined();
  });

  it("renders compile report stats when a report is available", async () => {
    const controller = createFakeController({
      readCurrentCompileReport: vi.fn(async () => FULL_REPORT),
    });
    const view = createView(controller);

    await view.render();

    const stats = contentElOf(view).findByClass("gotsaeng-os-stats");
    const statValues = (stats?.children ?? []).map((stat) => ({
      label: stat.children[0]?.text,
      value: stat.children[1]?.text,
    }));
    expect(statValues).toContainEqual({ label: "Files", value: "3" });
    expect(statValues).toContainEqual({ label: "Markdown", value: "2" });
    expect(statValues).toContainEqual({ label: "Items", value: "5" });
    expect(statValues).toContainEqual({ label: "Warnings", value: "1" });
    expect(statValues).toContainEqual({ label: "Missing updated", value: "1" });
    expect(statValues).toContainEqual({ label: "Weak provenance", value: "1" });
    expect(statValues).toContainEqual({ label: "Low confidence", value: "2" });
    expect(statValues).toContainEqual({ label: "Contradictions", value: "1" });
  });

  it("falls back to zero for optional stats missing from the report", async () => {
    const controller = createFakeController({
      readCurrentCompileReport: vi.fn(async () => MINIMAL_REPORT),
    });
    const view = createView(controller);

    await view.render();

    const stats = contentElOf(view).findByClass("gotsaeng-os-stats");
    const items = stats?.children.find((stat) => stat.children[0]?.text === "Items");
    expect(items?.children[1]?.text).toBe("0");
  });

  it("marks the selected artifact button active and lets clicking another one select it", async () => {
    const controller = createFakeController({ selectedOutputFileName: "REPORT_HUB.md" });
    const view = createView(controller);

    await view.render();

    const artifactGrid = contentElOf(view).findByClass("gotsaeng-os-artifact-grid");
    const buttons = artifactGrid?.children ?? [];
    const activeButton = buttons.find((button) => button.cls.includes("is-active"));
    expect(activeButton?.text).toBe("Report Hub");

    const weeklyReviewButton = buttons.find((button) => button.text === "Weekly Review");
    weeklyReviewButton?.dispatch("click");
    // The click handler is async (`void this.render()`); flush microtasks.
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.setSelectedOutputFileName).toHaveBeenCalledWith("WEEKLY_REVIEW_CONTEXT.md");
  });

  it("wires action buttons to controller commands and refreshes afterward", async () => {
    const controller = createFakeController();
    const view = createView(controller);

    await view.render();

    const actions = contentElOf(view).findByClass("gotsaeng-os-action-grid");
    const compileButton = actions?.children.find((button) => button.text === "Compile");
    compileButton?.dispatch("click");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.compileContextPackCommand).toHaveBeenCalledTimes(1);

    const weeklyReviewButton = actions?.children.find((button) => button.text === "Weekly Review");
    weeklyReviewButton?.dispatch("click");
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.generateWeeklyReviewCommand).toHaveBeenCalledTimes(1);
  });

  it("reports its Obsidian view identity and re-renders when opened", async () => {
    const controller = createFakeController();
    const view = createView(controller);

    expect(view.getViewType()).toBe(GOTSAENG_REPORT_VIEW_TYPE);
    expect(view.getDisplayText()).toBe("GotSaeng OS");

    await view.onOpen();

    expect(controller.readCurrentCompileReport).toHaveBeenCalledTimes(1);
    expect(contentElOf(view).findByClass("gotsaeng-os-report-view")).toBeUndefined();
    expect(contentElOf(view).cls).toContain("gotsaeng-os-report-view");
  });
});

describe("GotSaengReportHubView artifact preview", () => {
  it("shows a not-found message when the selected artifact has no content yet", async () => {
    const controller = createFakeController({
      selectedOutputFileName: "REPORT_HUB.md",
      readOutputFileByName: vi.fn(async () => null),
    });
    const view = createView(controller);

    await view.render();

    const notFound = contentElOf(view).children.find((el) =>
      el.text?.includes("No REPORT_HUB.md file found yet"),
    );
    expect(notFound).toBeDefined();
    expect(renderedMarkdown).toHaveLength(0);
  });

  it("renders markdown artifacts through MarkdownRenderer and extracts source links", async () => {
    const content = "- Follow up ([[10_Wiki/source-note.md|Source Note]]; status: open)";
    const controller = createFakeController({
      selectedOutputFileName: "REPORT_HUB.md",
      settings: { ...DEFAULT_SETTINGS, outputFolder: "Gotsaeng/Context Pack" },
      readOutputFileByName: vi.fn(async () => content),
    });
    const view = createView(controller);

    await view.render();

    expect(renderedMarkdown).toHaveLength(1);
    expect(renderedMarkdown[0]?.markdown).toBe(content);
    expect(renderedMarkdown[0]?.sourcePath).toBe("Gotsaeng/Context Pack/REPORT_HUB.md");

    const sourceButtons = contentElOf(view).findByClass("gotsaeng-os-source-grid");
    const button = sourceButtons?.children[0];
    expect(button?.text).toBe("Source Note");

    button?.dispatch("click");
    await Promise.resolve();

    expect(controller.openSourceFileByPath).toHaveBeenCalledWith("10_Wiki/source-note.md");
  });

  it("shows a no-source-links message when the artifact has none", async () => {
    const controller = createFakeController({
      selectedOutputFileName: "REPORT_HUB.md",
      readOutputFileByName: vi.fn(async () => "Nothing to link here."),
    });
    const view = createView(controller);

    await view.render();

    const sourcePanel = contentElOf(view).findByClass("gotsaeng-os-source-panel");
    const message = sourcePanel?.children.find((el) =>
      el.text?.includes("No source-note links found"),
    );
    expect(message).toBeDefined();
  });

  it("formats JSON artifacts as pretty-printed JSON instead of rendering markdown", async () => {
    const controller = createFakeController({
      selectedOutputFileName: "COMPILE_REPORT.json",
      readOutputFileByName: vi.fn(async () => JSON.stringify({ a: 1 })),
    });
    const view = createView(controller);

    await view.render();

    expect(renderedMarkdown).toHaveLength(0);
    const preview = contentElOf(view).findByClass("gotsaeng-os-artifact-preview");
    const code = preview?.children[0]?.children[0];
    expect(code?.text).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  it("falls back to the raw text when a JSON artifact's content does not parse", async () => {
    const controller = createFakeController({
      selectedOutputFileName: "COMPILE_REPORT.json",
      readOutputFileByName: vi.fn(async () => "{not valid json"),
    });
    const view = createView(controller);

    await view.render();

    const preview = contentElOf(view).findByClass("gotsaeng-os-artifact-preview");
    const code = preview?.children[0]?.children[0];
    expect(code?.text).toBe("{not valid json");
  });
});
