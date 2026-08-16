import type { CompileReport } from "@gotsaeng/core";
import type { WorkspaceLeaf } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_OUTPUT_ARTIFACT } from "../src/artifacts";
import { DEFAULT_SETTINGS } from "../src/settings";
import {
  GOTSAENG_REPORT_VIEW_TYPE,
  GotSaengReportHubView,
  capPreviewContent,
  describeCompileTime,
  formatErrorTimestamp,
  type CompileReportRead,
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
    // A compiled vault, because that is the state the great majority of these
    // tests are about: the stats rows, the artifact grid, the preview, its
    // source panel and the backlink list all exist only once a compile report
    // does. `status: "missing"` renders the cold-start state instead (see
    // renderFirstRunNote in src/view.ts), and the tests that are about that
    // state override this to say so.
    readCurrentCompileReport: vi.fn(
      async (): Promise<CompileReportRead> => ({
        status: "ok",
        report: FULL_REPORT,
        generatedAt: null,
      }),
    ),
    dismissLastError: vi.fn(),
    refreshReportHubViews: vi.fn(async () => {}),
    ...overrides,
  };
}

/** Every stat tile on the pane, across the health row and the details row. */
function statsOf(
  view: GotSaengReportHubView,
): { label: string | undefined; value: string | undefined }[] {
  return contentElOf(view)
    .findAllByClass("gotsaeng-os-stat")
    .map((stat) => ({ label: stat.children[0]?.text, value: stat.children[1]?.text }));
}

function missingReportController(
  overrides: Partial<ReportHubController> = {},
): ReportHubController {
  return createFakeController({
    readCurrentCompileReport: vi.fn(
      async (): Promise<CompileReportRead> => ({ status: "missing" }),
    ),
    ...overrides,
  });
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

// Everything render() rebuilds lives inside this wrapper. The static header and
// the two live regions are siblings of it that deliberately survive renders —
// see ReportHubShell in src/view.ts — so assertions about rebuilt content look
// here rather than directly at contentEl's children.
function bodyOf(view: GotSaengReportHubView): FakeElement {
  const body = contentElOf(view).findByClass("gotsaeng-os-report-body");
  if (!body) {
    throw new Error("expected the Report Hub to have rendered its body container");
  }
  return body;
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
  it("shows one focused get-started state, not five sections of empty ones, before the first compile", async () => {
    const view = createView(missingReportController());

    await view.render();

    const firstRun = contentElOf(view).findByClass("gotsaeng-os-first-run");
    expect(firstRun?.children[0]?.text).toBe("No context pack yet");
    expect(firstRun?.children[1]?.text).toContain("Run Compile");

    // The four command buttons stay — they are the whole point of this state —
    // and so does where the output will land.
    expect(contentElOf(view).findByClass("gotsaeng-os-action-grid")?.children).toHaveLength(4);
    expect(contentElOf(view).findByClass("gotsaeng-os-output-path")).toBeDefined();

    // Everything that could only say "nothing here yet" is not rendered at
    // all: the stats block, the twenty dead artifact buttons, the preview,
    // its source panel, and the backlink list.
    expect(contentElOf(view).findByClass("gotsaeng-os-stats")).toBeUndefined();
    expect(contentElOf(view).findByClass("gotsaeng-os-artifact-grid")).toBeUndefined();
    expect(contentElOf(view).findByClass("gotsaeng-os-artifact-preview")).toBeUndefined();
    expect(contentElOf(view).findByClass("gotsaeng-os-source-panel")).toBeUndefined();
    expect(contentElOf(view).findByClass("gotsaeng-os-backlink-list")).toBeUndefined();
    expect(
      bodyOf(view)
        .findAllByTag("h3")
        .map((heading) => heading.text),
    ).toEqual(["No context pack yet", "Output"]);
  });

  it("shows the full pane, not the get-started state, when Validate already produced a report with no compile ever run (#Codex P1)", async () => {
    // Validate writes VALIDATION_REPORT.md without ever calling
    // compileToOutput(), so it never produces COMPILE_REPORT.json — a vault
    // whose first-ever action was Validate still reads back `status:
    // "missing"` here. With a hidden output folder, main.ts's openOutputFile
    // routes back to this view instead of opening the file directly, having
    // already set `selectedOutputFileName` to the report it just wrote. The
    // get-started state must not swallow that: there is a real artifact to
    // show, and no way to reach it from the get-started state's four buttons.
    const controller = missingReportController({ selectedOutputFileName: "VALIDATION_REPORT.md" });
    const view = createView(controller);

    await view.render();

    expect(contentElOf(view).findByClass("gotsaeng-os-first-run")).toBeUndefined();
    expect(contentElOf(view).findByClass("gotsaeng-os-artifact-grid")).toBeDefined();
    // The compile-report note here is specifically the "none has run yet"
    // wording, not the "one exists but could not be read" wording the
    // "unreadable" status uses — no compile was ever attempted, so nothing
    // should tell the user to "re-run" one. Scoped to `body` because the
    // shell's own static intro paragraph carries this same class.
    const notes = bodyOf(view)
      .findAllByClass("gotsaeng-os-view-note")
      .map((note) => note.text);
    expect(notes).toContain("No compile report found yet. Run Compile to create one.");
  });

  it("does not sweep the output folder for backlinks before the first compile", async () => {
    const controller = missingReportController();
    const view = createView(controller);

    await view.render();

    // Nothing downstream of the compile report is rendered, so the 17-file
    // read that feeds the backlink index is not worth doing either.
    expect(controller.readAllOutputFiles).not.toHaveBeenCalled();
    expect(controller.readOutputFileByName).not.toHaveBeenCalled();
  });

  it("drops the cold-start state and renders the full pane once a compile report exists", async () => {
    const view = createView(createFakeController());

    await view.render();

    expect(contentElOf(view).findByClass("gotsaeng-os-first-run")).toBeUndefined();
    expect(contentElOf(view).findByClass("gotsaeng-os-artifact-grid")).toBeDefined();
  });

  it("renders compile report stats when a report is available", async () => {
    const view = createView(createFakeController());

    await view.render();

    const statValues = statsOf(view);
    expect(statValues).toContainEqual({ label: "Files", value: "3" });
    expect(statValues).toContainEqual({ label: "Markdown", value: "2" });
    expect(statValues).toContainEqual({ label: "Items", value: "5" });
    expect(statValues).toContainEqual({ label: "Warnings", value: "1" });
    expect(statValues).toContainEqual({ label: "Missing updated", value: "1" });
    expect(statValues).toContainEqual({ label: "Weak provenance", value: "1" });
    expect(statValues).toContainEqual({ label: "Low confidence", value: "2" });
    expect(statValues).toContainEqual({ label: "Contradictions", value: "1" });
  });

  it("leads with the three health signals and demotes the other eight, without dropping any", async () => {
    const view = createView(createFakeController());

    await view.render();

    const labelsOf = (cls: string): (string | undefined)[] =>
      contentElOf(view)
        .findByClass(cls)
        ?.children.map((stat) => stat.children[0]?.text) ?? [];

    // Both sub-grids must still carry the shared class the missing-report
    // test above asserts the ABSENCE of, and the @container query at
    // styles.css targets — dropping it from either sub-grid would pass that
    // absence check and silently disable the responsive rule for it too.
    expect(contentElOf(view).findByClass("gotsaeng-os-stats")).toBeDefined();

    // "Is anything wrong with my vault right now" first...
    expect(labelsOf("gotsaeng-os-stats-health")).toEqual([
      "Warnings",
      "Parse errors",
      "Contradictions",
    ]);
    // ...and the eight that describe its shape after, all still present.
    expect(labelsOf("gotsaeng-os-stats-details")).toEqual([
      "Files",
      "Markdown",
      "Items",
      "Missing updated",
      "Avg provenance",
      "Weak provenance",
      "Avg confidence",
      "Low confidence",
    ]);
  });

  it("falls back to zero for optional stats missing from the report", async () => {
    const controller = createFakeController({
      readCurrentCompileReport: vi.fn(
        async (): Promise<CompileReportRead> => ({
          status: "ok",
          report: MINIMAL_REPORT,
          generatedAt: null,
        }),
      ),
    });
    const view = createView(controller);

    await view.render();

    expect(statsOf(view)).toContainEqual({ label: "Items", value: "0" });
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

  it("does not duplicate preview, source, and backlink sections when a second render starts mid-flight (#2)", async () => {
    // Clicking Compile triggers refreshReportHubViews() twice in quick
    // succession (once from the command, once from openOutputFile after it).
    // render() empties contentEl near the top and awaits further down, so the
    // first render's tail used to append its preview/source/backlink sections
    // onto the second render's already-finished DOM.
    let releaseFirstRead: () => void = () => {};
    const firstRead = new Promise<void>((resolve) => {
      releaseFirstRead = resolve;
    });
    let readCount = 0;
    const controller = createFakeController({
      selectedOutputFileName: "REPORT_HUB.md",
      readOutputFileByName: vi.fn(async () => {
        readCount += 1;
        if (readCount === 1) {
          await firstRead;
        }
        return "- Follow up ([[10_Wiki/source-note.md|Source Note]]; status: open)";
      }),
    });
    const view = createView(controller);

    const firstRender = view.render();
    // Let the first render reach (and suspend inside) its artifact read.
    await vi.waitFor(() => {
      if (readCount === 0) {
        throw new Error("expected the first render to start reading the artifact");
      }
    });

    await view.render();
    releaseFirstRead();
    await firstRender;

    expect(contentElOf(view).findAllByClass("gotsaeng-os-artifact-preview")).toHaveLength(1);
    expect(contentElOf(view).findAllByClass("gotsaeng-os-source-panel")).toHaveLength(1);
    expect(
      contentElOf(view).findAllByClass("gotsaeng-os-backlink-list").length,
    ).toBeLessThanOrEqual(1);
    const backlinkHeadings = bodyOf(view).children.filter(
      (child) => child.tag === "h3" && child.text === "Backlinks",
    );
    expect(backlinkHeadings).toHaveLength(1);
  });

  it("does not degrade the pane when a superseded render's delayed failure arrives after a newer render already succeeded (#Codex P2)", async () => {
    // A render that is about to fail can still be interleaved with a newer
    // one the same way two successful renders can (#2's test above) — the
    // failure just arrives later. Falling back to the degraded state
    // unconditionally on that failure would wipe out the newer, valid render
    // already on screen to report a failure that is no longer current.
    let releaseFirstRead: (() => void) | undefined;
    const firstRead = new Promise<void>((_resolve, reject) => {
      releaseFirstRead = () => reject(new Error("stale read failed"));
    });
    let readCount = 0;
    const controller = createFakeController({
      readCurrentCompileReport: vi.fn(async (): Promise<CompileReportRead> => {
        readCount += 1;
        if (readCount === 1) {
          await firstRead;
        }
        return { status: "ok", report: FULL_REPORT, generatedAt: null };
      }),
    });
    const view = createView(controller);

    // onOpen() is the public entry point that exercises the private
    // safeRender/renderSafely path this test is about — a bare
    // view.render() call would leave its rejection unhandled instead of
    // reaching renderDegraded() at all.
    void view.onOpen();
    await vi.waitFor(() => {
      if (readCount === 0) {
        throw new Error("expected the first render to start reading the compile report");
      }
    });

    // A second, later render starts and completes successfully — it
    // supersedes the first, which is still suspended above.
    await view.render();
    expect(contentElOf(view).findByClass("gotsaeng-os-artifact-grid")).toBeDefined();

    // The stale first render's read now rejects.
    releaseFirstRead?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The pane must still show the newer, successful render, not the
    // degraded fallback the stale rejection would otherwise trigger.
    expect(contentElOf(view).findByClass("gotsaeng-os-artifact-grid")).toBeDefined();
    expect(contentElOf(view).findByClass("gotsaeng-os-error-banner-message")).toBeUndefined();
  });

  it("disables every action button while any command is running, not just the clicked one (#3)", async () => {
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
    actions?.children.find((button) => button.text === "Compile")?.dispatch("click");
    await Promise.resolve();

    // Every command writes into the same output directory, so a second one
    // started mid-flight would interleave its writes with the first's.
    expect(actions?.children.every((button) => button.disabled)).toBe(true);
    expect(
      actions?.children.filter((button) => button.cls.includes("is-running")).map((b) => b.text),
    ).toEqual(["Compile…"]);

    // The mid-flight re-render every command performs must not bring the other
    // three buttons back enabled.
    await view.render();
    const midFlightActions = contentElOf(view).findByClass("gotsaeng-os-action-grid");
    expect(midFlightActions?.children.every((button) => button.disabled)).toBe(true);
    midFlightActions?.children.find((button) => button.text === "Weekly Review")?.dispatch("click");
    expect(controller.generateWeeklyReviewCommand).not.toHaveBeenCalled();

    resolveCompile();
    await pending;
    await Promise.resolve();
    await Promise.resolve();

    const finalActions = contentElOf(view).findByClass("gotsaeng-os-action-grid");
    expect(finalActions?.children.some((button) => button.disabled)).toBe(false);
  });

  it("shows a distinct message when the compile report exists but cannot be read (#4)", async () => {
    const controller = createFakeController({
      readCurrentCompileReport: vi.fn(
        async (): Promise<CompileReportRead> => ({
          status: "unreadable",
        }),
      ),
    });
    const view = createView(controller);

    await view.render();

    const message = bodyOf(view).children.find((child) =>
      child.text?.includes("Compile report could not be read"),
    );
    expect(message).toBeDefined();
    // Unreadable is not the same as never-compiled: output files may well
    // exist, so the rest of the pane still renders rather than collapsing to
    // the cold-start state.
    expect(contentElOf(view).findByClass("gotsaeng-os-first-run")).toBeUndefined();
    expect(contentElOf(view).findByClass("gotsaeng-os-artifact-grid")).toBeDefined();
  });

  it("keeps an empty assertive error region and a polite status region in the DOM on every render (#5)", async () => {
    const controller = createFakeController();
    const view = createView(controller);

    await view.render();

    // The region has to exist *before* a message lands in it, or the
    // announcement never fires — so it is rendered empty, not conditionally.
    const errorRegion = contentElOf(view).findByClass("gotsaeng-os-error-region");
    expect(errorRegion?.getAttr("role")).toBe("alert");
    expect(errorRegion?.getAttr("aria-live")).toBe("assertive");
    expect(errorRegion?.children).toHaveLength(0);

    const statusRegion = contentElOf(view).findByClass("gotsaeng-os-status-region");
    expect(statusRegion?.getAttr("role")).toBe("status");
    expect(statusRegion?.getAttr("aria-live")).toBe("polite");
    expect(statusRegion?.text).toBeUndefined();
  });

  it("announces a command's start and finish, and clears aria-busy on the button it set it on (#5)", async () => {
    let resolveCompile: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveCompile = resolve;
    });
    const controller = createFakeController({
      compileContextPackCommand: vi.fn(() => pending),
    });
    const view = createView(controller);

    await view.render();

    const compileButton = contentElOf(view)
      .findByClass("gotsaeng-os-action-grid")
      ?.children.find((button) => button.text === "Compile");
    compileButton?.dispatch("click");
    await Promise.resolve();
    await view.render();

    expect(contentElOf(view).findByClass("gotsaeng-os-status-region")?.text).toBe(
      "Compile started.",
    );

    resolveCompile();
    await pending;
    await Promise.resolve();
    await Promise.resolve();

    expect(contentElOf(view).findByClass("gotsaeng-os-status-region")?.text).toBe(
      "Compile finished.",
    );
    // Cleared explicitly on the element that carried it, rather than left for
    // the re-render to discard.
    expect(compileButton?.getAttr("aria-busy")).toBe("false");
    expect(compileButton?.cls).not.toContain("is-running");
  });

  it("tags action buttons, artifact buttons, and the filter with a stable focus key (#6)", async () => {
    const controller = createFakeController({ selectedOutputFileName: "REPORT_HUB.md" });
    const view = createView(controller);

    await view.render();

    const compileButton = contentElOf(view)
      .findByClass("gotsaeng-os-action-grid")
      ?.children.find((button) => button.text === "Compile");
    expect(compileButton?.getAttr("data-focus-key")).toBe("action:Compile");

    const reportHubButton = contentElOf(view)
      .findByClass("gotsaeng-os-artifact-grid")
      ?.children.find((button) => button.text === "Report Hub");
    expect(reportHubButton?.getAttr("data-focus-key")).toBe("artifact:REPORT_HUB.md");

    expect(
      contentElOf(view).findByClass("gotsaeng-os-artifact-filter")?.getAttr("data-focus-key"),
    ).toBe("artifact-filter");
  });

  it("restores focus to the action button that started a command, across the disable that blurs it", async () => {
    let resolveCompile: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveCompile = resolve;
    });
    // Every real command calls refreshReportHubViews() partway through its own
    // work, so the button is rebuilt (still disabled) mid-flight before the
    // command settles — the request has to survive that render too.
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

    const compileButton = contentElOf(view)
      .findByClass("gotsaeng-os-action-grid")
      ?.children.find((button) => button.text === "Compile");
    compileButton?.focus();
    expect(document.activeElement).toBe(compileButton);

    compileButton?.dispatch("click");
    await Promise.resolve();

    // Starting a command disables all four buttons, which blurs the clicked
    // one — so by the time any render captures the focused element there is
    // nothing focus-keyed left to find. The intent has to be recorded before
    // that happens, or focus restoration for these buttons is a no-op.
    expect(document.activeElement).toBe(document.body);

    await midRenderDone;
    // The mid-flight rebuild cannot honor the request yet: the rebuilt button
    // is still disabled, so focus() is ignored and the request has to be kept
    // for the render that follows the command.
    expect(document.activeElement).toBe(document.body);

    resolveCompile();
    await pending;
    await vi.waitFor(() => {
      if (document.activeElement === document.body) {
        throw new Error("expected focus to return to the Compile button");
      }
    });

    const rebuiltCompileButton = contentElOf(view)
      .findByClass("gotsaeng-os-action-grid")
      ?.children.find((button) => button.text === "Compile");
    expect(rebuiltCompileButton).not.toBe(compileButton);
    expect(document.activeElement).toBe(rebuiltCompileButton);
    expect(document.activeElement?.getAttribute("data-focus-key")).toBe("action:Compile");
  });

  it("restores focus to the artifact button that triggered a re-render", async () => {
    const controller = createFakeController({ selectedOutputFileName: "REPORT_HUB.md" });
    const view = createView(controller);

    await view.render();

    const grid = contentElOf(view).findByClass("gotsaeng-os-artifact-grid");
    const weeklyReviewButton = grid?.children.find((button) => button.text === "Weekly Review");
    weeklyReviewButton?.focus();
    weeklyReviewButton?.dispatch("click");

    await vi.waitFor(() => {
      if (document.activeElement === document.body) {
        throw new Error("expected focus to survive the re-render");
      }
    });

    // A different element in a rebuilt tree — the point of restoring by key
    // rather than by object identity.
    expect(document.activeElement).not.toBe(weeklyReviewButton);
    expect(document.activeElement?.getAttribute("data-focus-key")).toBe(
      "artifact:WEEKLY_REVIEW_CONTEXT.md",
    );
  });

  it("announces a command's start immediately, not only once the next render lands (#5)", async () => {
    let resolveCompile: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      resolveCompile = resolve;
    });
    const controller = createFakeController({
      compileContextPackCommand: vi.fn(() => pending),
    });
    const view = createView(controller);

    await view.render();

    const statusRegion = contentElOf(view).findByClass("gotsaeng-os-status-region");
    const compileButton = contentElOf(view)
      .findByClass("gotsaeng-os-action-grid")
      ?.children.find((button) => button.text === "Compile");
    compileButton?.dispatch("click");

    // No render in between: the text is written straight into the live region.
    // Waiting for the next render would have batched "started" together with
    // "finished" for every command that completes in one pass.
    expect(statusRegion?.text).toBe("Compile started.");

    resolveCompile();
    await pending;
    await Promise.resolve();
    await Promise.resolve();

    // Same element throughout — a live region rebuilt per render is a region
    // assistive technology never saw before its content changed.
    expect(contentElOf(view).findByClass("gotsaeng-os-status-region")).toBe(statusRegion);
    expect(statusRegion?.text).toBe("Compile finished.");
  });

  it("announces a command as failed, not finished, when it fails through runSafely's non-rejecting error path (#Codex P2)", async () => {
    // Every real command routes through main.ts's runSafely(), which catches
    // the command's own failure, records it as controller.lastError, and
    // resolves normally rather than rejecting — action() not throwing here is
    // not proof the command succeeded.
    const controller = createFakeController({
      compileContextPackCommand: vi.fn(async () => {
        controller.lastError = {
          action: "Compile Context Pack",
          message: "disk full",
          timestamp: 1,
        };
      }),
    });
    const view = createView(controller);

    await view.render();

    const compileButton = contentElOf(view)
      .findByClass("gotsaeng-os-action-grid")
      ?.children.find((button) => button.text === "Compile");
    compileButton?.dispatch("click");
    await Promise.resolve();
    await Promise.resolve();

    const statusRegion = contentElOf(view).findByClass("gotsaeng-os-status-region");
    expect(statusRegion?.text).toBe("Compile failed.");
  });

  it("keeps the same live region elements across renders so a message is a change, not an appearance (#5)", async () => {
    const controller = createFakeController();
    const view = createView(controller);

    await view.render();
    const errorRegion = contentElOf(view).findByClass("gotsaeng-os-error-region");
    const statusRegion = contentElOf(view).findByClass("gotsaeng-os-status-region");

    controller.lastError = {
      action: "Compile Context Pack",
      message: "disk full",
      timestamp: 1_700_000_000_000,
    };
    await view.render();

    expect(contentElOf(view).findByClass("gotsaeng-os-error-region")).toBe(errorRegion);
    expect(contentElOf(view).findByClass("gotsaeng-os-status-region")).toBe(statusRegion);
    expect(errorRegion?.findByClass("gotsaeng-os-error-banner-message")?.text).toBe("disk full");
  });

  it("renders a degraded state instead of leaving an unhandled rejection when a render fails (#12)", async () => {
    let shouldFail = false;
    const controller = createFakeController({
      readCurrentCompileReport: vi.fn(async (): Promise<CompileReportRead> => {
        if (shouldFail) {
          throw new Error("compile report read exploded");
        }
        return { status: "ok", report: FULL_REPORT, generatedAt: null };
      }),
    });
    const view = createView(controller);

    await view.render();

    shouldFail = true;
    // The artifact-button click handler discards its render promise, so a
    // failure there used to surface only as an unhandled rejection.
    contentElOf(view).findByClass("gotsaeng-os-artifact-grid")?.children[1]?.dispatch("click");

    await vi.waitFor(() => {
      const degraded = contentElOf(view).findByClass("gotsaeng-os-error-banner-message");
      if (!degraded?.text?.includes("could not be rendered")) {
        throw new Error("expected a degraded render state");
      }
    });
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

    const notFound = bodyOf(view).children.find((el) =>
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

    const message = bodyOf(view).children.find((el) =>
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

describe("capPreviewContent", () => {
  it("returns the content untouched when it is inside both limits", () => {
    const slice = capPreviewContent("a\nb\nc");

    expect(slice).toEqual({ text: "a\nb\nc", truncated: false, shownLines: 3, totalLines: 3 });
  });

  it("cuts at the line limit and reports how much was left out", () => {
    const content = Array.from({ length: 12 }, (_, index) => `line ${index}`).join("\n");

    const slice = capPreviewContent(content, 5);

    expect(slice.text).toBe("line 0\nline 1\nline 2\nline 3\nline 4");
    expect(slice).toMatchObject({ truncated: true, shownLines: 5, totalLines: 12 });
  });

  it("cuts on a line boundary when the character limit is hit first", () => {
    const content = Array.from({ length: 12 }, () => "0123456789").join("\n");

    const slice = capPreviewContent(content, 100, 25);

    // 25 characters lands mid-line; the slice backs up to the last newline
    // rather than ending halfway through a line of a Markdown document.
    expect(slice.text).toBe("0123456789\n0123456789");
    expect(slice).toMatchObject({ truncated: true, shownLines: 2, totalLines: 12 });
  });

  it("cuts mid-line when a single line is longer than the character limit", () => {
    const slice = capPreviewContent("0123456789", 100, 4);

    expect(slice).toEqual({ text: "0123", truncated: true, shownLines: 1, totalLines: 1 });
  });
});

describe("GotSaengReportHubView preview size cap", () => {
  // 2001 lines: one past PREVIEW_MAX_LINES in src/view.ts.
  const HUGE_MARKDOWN = Array.from({ length: 2001 }, (_, index) => `- item ${index}`).join("\n");

  it("renders only the capped slice of an oversized Markdown artifact", async () => {
    const controller = createFakeController({
      readOutputFileByName: vi.fn(async () => HUGE_MARKDOWN),
    });
    const view = createView(controller);

    await view.render();

    expect(renderedMarkdown).toHaveLength(1);
    expect(renderedMarkdown[0]?.markdown.split("\n")).toHaveLength(2000);
  });

  it("says how much is being shown and offers to open the whole file", async () => {
    const controller = createFakeController({
      readOutputFileByName: vi.fn(async () => HUGE_MARKDOWN),
    });
    const view = createView(controller);

    await view.render();

    const note = bodyOf(view).findByClass("gotsaeng-os-preview-truncation");
    expect(note?.children[0]?.text).toBe("Showing the first 2000 of 2001 lines.");

    const openButton = note?.children[1];
    expect(openButton?.text).toBe("Open REPORT_HUB.md");
    openButton?.dispatch("click");
    await Promise.resolve();
    expect(controller.openOutputFileByName).toHaveBeenCalledWith("REPORT_HUB.md");
  });

  it("leaves an ordinary artifact untruncated", async () => {
    const controller = createFakeController({
      readOutputFileByName: vi.fn(async () => "- one\n- two"),
    });
    const view = createView(controller);

    await view.render();

    expect(bodyOf(view).findByClass("gotsaeng-os-preview-truncation")).toBeUndefined();
    expect(renderedMarkdown[0]?.markdown).toBe("- one\n- two");
  });
});

describe("GotSaengReportHubView render cost", () => {
  it("reuses the backlink index when the render was triggered by picking an artifact", async () => {
    const controller = createFakeController({
      readAllOutputFiles: vi.fn(async () => ({
        "REPORT_HUB.md": "- Follow up ([[10_Wiki/source-note.md|Source Note]])",
      })),
    });
    const view = createView(controller);

    await view.render();
    expect(controller.readAllOutputFiles).toHaveBeenCalledTimes(1);

    const artifactButton = bodyOf(view)
      .findAllByClass("gotsaeng-os-artifact-button")
      .find((button) => button.text === "Decision Log");
    artifactButton?.dispatch("click");
    await vi.waitFor(() => {
      expect(controller.setSelectedOutputFileName).toHaveBeenCalledWith("DECISION_LOG.md");
      const entries = bodyOf(view).findAllByClass("gotsaeng-os-backlink-entry");
      expect(entries).toHaveLength(1);
    });

    // Selecting a different file to preview cannot change which source notes
    // the generated reports reference, so the 17-file sweep is not repeated —
    // but the backlinks are still on screen.
    expect(controller.readAllOutputFiles).toHaveBeenCalledTimes(1);
  });

  it("re-reads the output files on any other render", async () => {
    const controller = createFakeController({
      readAllOutputFiles: vi.fn(async () => ({})),
    });
    const view = createView(controller);

    await view.render();
    await view.render();

    expect(controller.readAllOutputFiles).toHaveBeenCalledTimes(2);
  });
});

// The responsive behavior itself (container queries, auto-fill grid tracks)
// lives entirely in styles.css and is NOT asserted here: jsdom parses CSS but
// runs no layout or cascade for it, so `getComputedStyle` reports the
// declared string rather than a resolved `grid-template-columns`, and
// `@container` conditions are never evaluated at all. Asserting on that would
// only prove the stylesheet's text, which a grep does just as well. What is
// testable is the measurement that CSS cannot make for itself:
describe("GotSaengReportHubView pane height", () => {
  function setPaneHeight(view: GotSaengReportHubView, height: number): void {
    Object.defineProperty(contentElOf(view), "clientHeight", {
      configurable: true,
      value: height,
    });
  }

  it("publishes the leaf's own height for the preview cap to size against", async () => {
    const view = createView(createFakeController());
    setPaneHeight(view, 640);

    await view.render();

    expect(contentElOf(view).style.getPropertyValue("--gotsaeng-os-pane-height")).toBe("640px");

    setPaneHeight(view, 320);
    view.onResize();
    expect(contentElOf(view).style.getPropertyValue("--gotsaeng-os-pane-height")).toBe("320px");
  });

  it("leaves the stylesheet's fallback in place when the pane has no measurable height", async () => {
    const view = createView(createFakeController());

    // jsdom reports 0 for every element; so does a real pane that is not laid
    // out yet. Neither is a measurement worth publishing.
    await view.render();

    expect(contentElOf(view).style.getPropertyValue("--gotsaeng-os-pane-height")).toBe("");
  });
});

describe("Latest Compile dateline", () => {
  const COMPILED_AT = "2026-08-15T14:14:00.000Z";

  function compiledController(generatedAt: string | null): ReportHubController {
    return createFakeController({
      readCurrentCompileReport: vi.fn(
        async (): Promise<CompileReportRead> => ({
          status: "ok",
          report: FULL_REPORT,
          generatedAt,
        }),
      ),
    });
  }

  // render() reads the wall clock itself, so the only way to pin the elapsed
  // time is to pin the clock. Restored in afterEach rather than at the end of
  // the test body, so a failing assertion cannot leak a frozen clock into
  // every test that runs after it.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says how long ago the compile ran, so the stats below it can't read as current", async () => {
    const view = createView(compiledController(COMPILED_AT));
    vi.setSystemTime(new Date(Date.parse(COMPILED_AT) + 5 * 60_000));

    await view.render();

    const dateline = contentElOf(view).findByClass("gotsaeng-os-compile-time");
    expect(dateline?.text).toContain("Compiled 5 minutes ago (");
  });

  it("says so plainly when no compile timestamp could be established", async () => {
    const view = createView(compiledController(null));

    await view.render();

    expect(contentElOf(view).findByClass("gotsaeng-os-compile-time")?.text).toBe(
      "Compile time unknown — run Compile to record one.",
    );
  });

  it("explains the direction of the two score metrics whose names don't", async () => {
    const view = createView(compiledController(COMPILED_AT));

    await view.render();

    const hints = contentElOf(view)
      .findAllByClass("gotsaeng-os-stat-hint")
      .map((hint) => hint.text);
    expect(hints).toEqual([
      "How well items cite a source. 0–100; higher is better.",
      "How certain each item's wording reads. 0–100; higher is better.",
    ]);
  });
});

describe("describeCompileTime", () => {
  const BASE = Date.parse("2026-08-15T12:00:00.000Z");

  it.each([
    [30_000, "just now"],
    [60_000, "1 minute ago"],
    [5 * 60_000, "5 minutes ago"],
    [3 * 3_600_000, "3 hours ago"],
    [50 * 3_600_000, "2 days ago"],
  ])("renders %ims elapsed as %s", (elapsedMs, expected) => {
    expect(describeCompileTime(new Date(BASE).toISOString(), BASE + elapsedMs)).toContain(
      `Compiled ${expected} (`,
    );
  });

  it("treats a clock that runs behind the compile as 'just now' rather than a future time", () => {
    expect(describeCompileTime(new Date(BASE).toISOString(), BASE - 60_000)).toContain(
      "Compiled just now (",
    );
  });

  it("reports an unparseable timestamp as unknown instead of 'Invalid Date'", () => {
    expect(describeCompileTime("not a date", BASE)).toBe(
      "Compile time unknown — run Compile to record one.",
    );
  });
});

describe("artifact filter feedback", () => {
  it("reports the live match count, and names the query when nothing matches", async () => {
    const view = createView(createFakeController());

    await view.render();

    const filterInput = contentElOf(view).findByClass("gotsaeng-os-artifact-filter");
    const status = contentElOf(view).findByClass("gotsaeng-os-artifact-filter-status");
    // A polite live region, so the count is spoken as it changes rather than
    // only being visible.
    expect(status?.getAttr("aria-live")).toBe("polite");
    // Nothing to say while the filter is empty: the grid below is the whole list.
    expect(status?.textContent).toBe("");

    filterInput!.value = "risk";
    filterInput!.dispatch("input");
    expect(status?.text).toBe("Showing 1 of 20 files.");

    // Filtering to zero used to leave a silent blank region with nothing
    // saying the query was the reason every group had disappeared.
    filterInput!.value = "nothing matches this";
    filterInput!.dispatch("input");
    expect(status?.text).toBe('No files match "nothing matches this".');

    filterInput!.value = "";
    filterInput!.dispatch("input");
    expect(status?.textContent).toBe("");
  });

  it("lives in the persistent shell and never re-announces text that has not changed", async () => {
    const view = createView(createFakeController());

    await view.render();

    const status = contentElOf(view).findByClass("gotsaeng-os-artifact-filter-status");
    const filterInput = contentElOf(view).findByClass("gotsaeng-os-artifact-filter");
    filterInput!.value = "risk";
    filterInput!.dispatch("input");
    expect(status?.text).toBe("Showing 1 of 20 files.");

    // Keystrokes that leave the match count alone must not rewrite the region:
    // an aria-live region re-announces whatever is written into it, so typing
    // four such characters would speak one identical sentence four times.
    const setText = vi.spyOn(status!, "setText");
    filterInput!.value = "risk ";
    filterInput!.dispatch("input");
    filterInput!.value = " risk";
    filterInput!.dispatch("input");
    expect(setText).not.toHaveBeenCalled();

    // And, like the error and status regions, it survives a full render rather
    // than being torn down with the body — a message landing in it is then a
    // change to something already in the accessibility tree, not a region that
    // appeared in the same pass as its content (see createLiveRegion).
    await view.render();
    expect(contentElOf(view).findByClass("gotsaeng-os-artifact-filter-status")).toBe(status);
    expect(status?.text).toBe("Showing 1 of 20 files.");
    expect(setText).not.toHaveBeenCalled();
  });

  it("also shows the count as plain text beside the input the filter belongs to", async () => {
    const view = createView(createFakeController());

    await view.render();

    const filterInput = contentElOf(view).findByClass("gotsaeng-os-artifact-filter");
    const count = bodyOf(view).findByClass("gotsaeng-os-artifact-filter-count");
    // The live region is pinned to the shell at the top of the pane, so on its
    // own the count was announced correctly but displayed nowhere near the
    // input that produced it. This copy is rebuilt with `body` on every render
    // and carries no live-region semantics — it is only ever read, not spoken.
    expect(count).toBeDefined();
    expect(count?.getAttr("aria-live")).toBeNull();
    // Hidden from assistive tech so it isn't read a second time alongside the
    // live region's own announcement of the same sentence.
    expect(count?.getAttr("aria-hidden")).toBe("true");
    expect(count?.textContent).toBe("");

    filterInput!.value = "risk";
    filterInput!.dispatch("input");
    expect(count?.text).toBe("Showing 1 of 20 files.");

    filterInput!.value = "nothing matches this";
    filterInput!.dispatch("input");
    expect(count?.text).toBe('No files match "nothing matches this".');

    filterInput!.value = "";
    filterInput!.dispatch("input");
    expect(count?.textContent).toBe("");
  });

  it("re-shows an identical status after a shell rebuild instead of suppressing it as unchanged", async () => {
    let shouldFail = false;
    const controller = createFakeController({
      readCurrentCompileReport: vi.fn(async (): Promise<CompileReportRead> => {
        if (shouldFail) {
          throw new Error("compile report read exploded");
        }
        return { status: "ok", report: FULL_REPORT, generatedAt: null };
      }),
    });
    const view = createView(controller);

    await view.render();
    const filterInput = contentElOf(view).findByClass("gotsaeng-os-artifact-filter");
    filterInput!.value = "risk";
    filterInput!.dispatch("input");
    expect(contentElOf(view).findByClass("gotsaeng-os-artifact-filter-status")?.text).toBe(
      "Showing 1 of 20 files.",
    );

    // renderDegraded empties contentEl and drops the shell, so the next render
    // builds a brand-new (and therefore empty) status region. Without
    // ensureShell resetting the identical-content guard, `lastFilterStatus`
    // would still hold the sentence painted into the *old* region and this
    // genuinely-new message would be dropped as "unchanged".
    shouldFail = true;
    await view.onOpen();
    expect(contentElOf(view).findByClass("gotsaeng-os-artifact-filter-status")).toBeUndefined();

    // The surviving filter query is re-applied as part of the rebuild, so the
    // same sentence is produced again — and must land in the new region.
    shouldFail = false;
    await view.render();

    expect(contentElOf(view).findByClass("gotsaeng-os-artifact-filter")?.value).toBe("risk");
    expect(contentElOf(view).findByClass("gotsaeng-os-artifact-filter-status")?.text).toBe(
      "Showing 1 of 20 files.",
    );
  });
});

describe("full paths on source and backlink buttons", () => {
  it("carries the note path in the accessible name, not only in a hover-only title", async () => {
    const content = "- Follow up ([[10_Wiki/source-note.md|Source Note]]; status: open)";
    const controller = createFakeController({
      selectedOutputFileName: "REPORT_HUB.md",
      readOutputFileByName: vi.fn(async () => content),
      readAllOutputFiles: vi.fn(async () => ({ "REPORT_HUB.md": content })),
    });
    const view = createView(controller);

    await view.render();

    const sourceButton = contentElOf(view).findByClass("gotsaeng-os-source-grid")?.children[0];
    expect(sourceButton?.title).toBe("10_Wiki/source-note.md");
    // The visible label leads (WCAG 2.5.3, "Label in Name") and the path the
    // label abbreviates follows it.
    expect(sourceButton?.getAttr("aria-label")).toBe("Source Note — 10_Wiki/source-note.md");

    const backlinkButton = contentElOf(view).findByClass("gotsaeng-os-backlink-note-button");
    expect(backlinkButton?.title).toBe("10_Wiki/source-note.md");
    expect(backlinkButton?.getAttr("aria-label")).toBe("Source Note (1) — 10_Wiki/source-note.md");
  });

  it("does not repeat the path when the visible label already is the path", async () => {
    const content = "- Follow up ([[10_Wiki/source-note.md]]; status: open)";
    const controller = createFakeController({
      selectedOutputFileName: "REPORT_HUB.md",
      readOutputFileByName: vi.fn(async () => content),
    });
    const view = createView(controller);

    await view.render();

    const sourceButton = contentElOf(view).findByClass("gotsaeng-os-source-grid")?.children[0];
    expect(sourceButton?.getAttr("aria-label")).toBe("10_Wiki/source-note.md");
  });
});
