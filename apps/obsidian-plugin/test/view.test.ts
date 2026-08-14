import type { CompileReport } from "@gotsaeng/core";
import type { WorkspaceLeaf } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_OUTPUT_ARTIFACT } from "../src/artifacts";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  GOTSAENG_REPORT_VIEW_TYPE,
  GotSaengReportHubView,
  formatErrorTimestamp,
  type ReportHubController,
} from "../src/view";
import { createFakeApp } from "./mocks/fake-app";
import { type FakeElement, renderedMarkdown, resetObsidianMocks } from "./mocks/obsidian";

function createFakeController(overrides: Partial<ReportHubController> = {}): ReportHubController {
  return {
    settings: { ...DEFAULT_SETTINGS },
    selectedOutputFileName: DEFAULT_OUTPUT_ARTIFACT.fileName,
    lastError: null,
    compileContextPackCommand: vi.fn(async () => {}),
    generateWeeklyReviewCommand: vi.fn(async () => {}),
    exportLlmHandoffCommand: vi.fn(async () => {}),
    validateVaultSchemaCommand: vi.fn(async () => {}),
    setSelectedOutputFileName: vi.fn(),
    readOutputFileByName: vi.fn(async () => null),
    readAllOutputFiles: vi.fn(async () => ({})),
    openOutputFileByName: vi.fn(async () => {}),
    openSourceFileByPath: vi.fn(async () => {}),
    readCurrentCompileReport: vi.fn(async () => null),
    dismissLastError: vi.fn(),
    refreshReportHubViews: vi.fn(async () => {}),
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

  it("disables the clicked action button while its command is in flight, then re-enables via re-render", async () => {
    let resolveCompile: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveCompile = resolve;
    });
    const controller = createFakeController({
      compileContextPackCommand: vi.fn(() => pending),
    });
    const view = createView(controller);

    await view.render();

    const actions = contentElOf(view).findByClass("gotsaeng-os-action-grid");
    const compileButton = actions?.children.find((button) => button.text === "Compile");
    compileButton?.dispatch("click");
    await Promise.resolve();

    expect(compileButton?.disabled).toBe(true);
    expect(compileButton?.cls).toContain("is-running");
    expect(compileButton?.getAttr("aria-busy")).toBe("true");
    expect(compileButton?.text).toBe("Compile…");

    // A second click while disabled must not fire the command again.
    compileButton?.dispatch("click");
    expect(controller.compileContextPackCommand).toHaveBeenCalledTimes(1);

    resolveCompile();
    await pending;
    await Promise.resolve();
    await Promise.resolve();

    const rebuiltActions = contentElOf(view).findByClass("gotsaeng-os-action-grid");
    const rebuiltCompileButton = rebuiltActions?.children.find(
      (button) => button.text === "Compile",
    );
    expect(rebuiltCompileButton?.disabled).toBe(false);
    expect(rebuiltCompileButton?.cls).not.toContain("is-running");
    expect(rebuiltCompileButton?.getAttr("aria-busy")).toBeNull();
  });

  it("keeps the busy state on a rebuilt button when the command itself triggers a render before it resolves", async () => {
    // main.ts's commands call the plugin's refreshReportHubViews() (i.e.
    // leaf.view.render()) partway through their own work, before the outer
    // promise runAndRefresh is awaiting resolves. That render() rebuilds the
    // action grid — including the very button being awaited — so the running
    // state must be re-applied to the new element, not just the original one.
    let resolveCompile: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveCompile = resolve;
    });
    const viewRef: { current?: GotSaengReportHubView } = {};
    let midRenderDone: Promise<void> | undefined;
    const controller = createFakeController({
      compileContextPackCommand: vi.fn(async () => {
        midRenderDone = viewRef.current?.render();
        await midRenderDone;
        await pending;
      }),
    });
    const view = createView(controller);
    viewRef.current = view;

    await view.render();

    const actions = contentElOf(view).findByClass("gotsaeng-os-action-grid");
    const compileButton = actions?.children.find((button) => button.text === "Compile");
    compileButton?.dispatch("click");
    await Promise.resolve();
    expect(midRenderDone).toBeDefined();
    await midRenderDone;

    const midFlightActions = contentElOf(view).findByClass("gotsaeng-os-action-grid");
    const midFlightCompileButton = midFlightActions?.children.find((button) =>
      (button.text ?? "").startsWith("Compile"),
    );
    expect(midFlightCompileButton?.disabled).toBe(true);
    expect(midFlightCompileButton?.cls).toContain("is-running");
    expect(midFlightCompileButton?.getAttr("aria-busy")).toBe("true");
    expect(midFlightCompileButton?.text).toBe("Compile…");

    resolveCompile();
    await pending;
    await Promise.resolve();
    await Promise.resolve();

    const finalActions = contentElOf(view).findByClass("gotsaeng-os-action-grid");
    const finalCompileButton = finalActions?.children.find((button) => button.text === "Compile");
    expect(finalCompileButton?.disabled).toBe(false);
    expect(finalCompileButton?.cls).not.toContain("is-running");
  });

  it("shows a persistent error banner with the action, timestamp, and message when the controller reports a last error", async () => {
    const lastError = {
      action: "Compile Context Pack",
      message: "disk full",
      timestamp: 1_700_000_000_000,
    };
    const controller = createFakeController({ lastError });
    const view = createView(controller);

    await view.render();

    const banner = contentElOf(view).findByClass("gotsaeng-os-error-banner");
    const meta = banner?.findByClass("gotsaeng-os-error-banner-meta");
    const message = banner?.findByClass("gotsaeng-os-error-banner-message");
    expect(meta?.text).toBe(`Compile Context Pack · ${formatErrorTimestamp(lastError.timestamp)}`);
    expect(message?.text).toBe("disk full");
  });

  it("shows no error banner when there is no last error", async () => {
    const controller = createFakeController({ lastError: null });
    const view = createView(controller);

    await view.render();

    expect(contentElOf(view).findByClass("gotsaeng-os-error-banner")).toBeUndefined();
  });

  it("dismisses the error banner independently of running another command, refreshing every mounted leaf", async () => {
    const lastError = {
      action: "Compile Context Pack",
      message: "disk full",
      timestamp: 1_700_000_000_000,
    };
    const controller = createFakeController({ lastError });
    const view = createView(controller);

    await view.render();

    const banner = contentElOf(view).findByClass("gotsaeng-os-error-banner");
    const dismissButton = banner?.findByClass("gotsaeng-os-error-banner-dismiss");
    dismissButton?.dispatch("click");
    await Promise.resolve();
    await Promise.resolve();

    expect(controller.dismissLastError).toHaveBeenCalledTimes(1);
    // `lastError` is shared plugin state, not per-leaf: a workspace with
    // multiple Report Hub leaves open needs every leaf refreshed, or the
    // other leaves keep showing a banner for an error that was already
    // dismissed from this one. re-rendering only `this.render()` would not
    // reach them, so the fix routes through the controller's all-leaves
    // refresh instead.
    expect(controller.refreshReportHubViews).toHaveBeenCalledTimes(1);
  });

  it("groups artifact buttons under Core Reports / Governance / Analysis / Raw Data headings", async () => {
    const controller = createFakeController();
    const view = createView(controller);

    await view.render();

    const headings = contentElOf(view)
      .findAllByClass("gotsaeng-os-artifact-group-heading")
      .map((el) => el.text);
    expect(headings).toEqual(["Core Reports", "Governance", "Analysis", "Raw Data"]);

    const grids = contentElOf(view).findAllByClass("gotsaeng-os-artifact-grid");
    expect(grids).toHaveLength(4);

    const rawGridButtons = grids[3]?.children.map((button) => button.text) ?? [];
    expect(rawGridButtons).toEqual([
      "Context Manifest JSON",
      "Compile Report JSON",
      "Artifact Index JSON",
    ]);
  });

  it("marks the selected artifact button's aria-pressed state and each grid group as an accessible group tied to its heading", async () => {
    const controller = createFakeController({ selectedOutputFileName: "REPORT_HUB.md" });
    const view = createView(controller);

    await view.render();

    const grids = contentElOf(view).findAllByClass("gotsaeng-os-artifact-grid");
    const headings = contentElOf(view).findAllByClass("gotsaeng-os-artifact-group-heading");
    const coreGrid = grids[0]!;
    const coreHeading = headings[0]!;

    expect(coreGrid.getAttr("role")).toBe("group");
    expect(coreGrid.getAttr("aria-labelledby")).toBe(coreHeading.getAttr("id"));

    const reportHubButton = coreGrid.children.find((button) => button.text === "Report Hub");
    const weeklyReviewButton = coreGrid.children.find((button) => button.text === "Weekly Review");
    expect(reportHubButton?.getAttr("aria-pressed")).toBe("true");
    expect(weeklyReviewButton?.getAttr("aria-pressed")).toBe("false");
  });

  it("filters artifact buttons by label as the user types, hiding empty groups", async () => {
    const controller = createFakeController();
    const view = createView(controller);

    await view.render();

    const filterInput = contentElOf(view).findByClass("gotsaeng-os-artifact-filter");
    expect(filterInput).toBeDefined();
    filterInput!.value = "risk";
    filterInput!.dispatch("input");

    const headings = contentElOf(view).findAllByClass("gotsaeng-os-artifact-group-heading");
    const grids = contentElOf(view).findAllByClass("gotsaeng-os-artifact-grid");

    // "Risk Register" lives only in Governance — every other group's heading
    // and grid should be hidden, and only the matching button stays visible.
    const governanceIndex = 1;
    for (const [index, heading] of headings.entries()) {
      expect(heading.hidden).toBe(index !== governanceIndex);
      expect(grids[index]!.hidden).toBe(index !== governanceIndex);
    }

    const governanceButtons = grids[governanceIndex]!.children;
    const visible = governanceButtons.filter((button) => !button.hidden);
    expect(visible.map((button) => button.text)).toEqual(["Risk Register"]);

    // Clearing the filter brings every group back.
    filterInput!.value = "";
    filterInput!.dispatch("input");
    expect(headings.every((heading) => !heading.hidden)).toBe(true);
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

describe("GotSaengReportHubView backlinks", () => {
  it("shows an empty-state message when no report references any source note", async () => {
    const controller = createFakeController({ readAllOutputFiles: vi.fn(async () => ({})) });
    const view = createView(controller);

    await view.render();

    const message = contentElOf(view).children.find((el) =>
      el.text?.includes("No source-note backlinks found yet"),
    );
    expect(message).toBeDefined();
  });

  it("groups source notes by note and lists which reports reference each one", async () => {
    const controller = createFakeController({
      readAllOutputFiles: vi.fn(async () => ({
        "REPORT_HUB.md": "- Follow up ([[10_Wiki/source-note.md|Source Note]]; status: open)",
        "ACTION_BACKLOG.md": [
          "- Again ([[10_Wiki/source-note.md|Source Note]])",
          "- Once ([[10_Wiki/source-note.md|Source Note]])",
        ].join("\n"),
      })),
    });
    const view = createView(controller);

    await view.render();

    const list = contentElOf(view).findByClass("gotsaeng-os-backlink-list");
    const entries = list?.findAllByClass("gotsaeng-os-backlink-entry") ?? [];
    expect(entries).toHaveLength(1);

    const button = entries[0]?.findByClass("gotsaeng-os-backlink-note-button");
    expect(button?.text).toBe("Source Note (3)");

    button?.dispatch("click");
    await Promise.resolve();
    expect(controller.openSourceFileByPath).toHaveBeenCalledWith("10_Wiki/source-note.md");

    const reports = entries[0]?.findByClass("gotsaeng-os-backlink-reports");
    expect(reports?.text).toBe("Action Backlog (2), Report Hub");
  });
});
