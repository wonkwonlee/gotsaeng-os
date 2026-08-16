import type { CompileReport } from "@gotsaeng/core";
import { ItemView, MarkdownRenderer, type WorkspaceLeaf } from "obsidian";

import { FocusRestorer, createLiveRegion } from "./a11y";
import { DEFAULT_OUTPUT_ARTIFACT, groupOutputArtifacts, type OutputArtifact } from "./artifacts";
import type { GotSaengPluginSettings } from "./settings";
import {
  buildBacklinkIndex,
  extractSourceLinks,
  type NoteBacklinks,
  type SourceLink,
} from "./source-links";

export const GOTSAENG_REPORT_VIEW_TYPE = "gotsaeng-report-hub";

const BACKLINK_NOTE_LIMIT = 20;
const BACKLINK_REPORT_LIMIT = 6;
const ARTIFACT_GROUPS = groupOutputArtifacts();

// Every `h3` this pane renders as a section divider carries this class, and
// the stylesheet demotes them to quiet reference labels so the command buttons
// above them are the loudest thing on the pane. It is a class rather than a
// `.gotsaeng-os-report-body h3` descendant selector on purpose: the artifact
// preview renders arbitrary vault Markdown, whose own `h3`s are document
// content and must keep the theme's heading styling.
const SECTION_HEADING_CLASS = "gotsaeng-os-section-heading";

// Ceilings on how much of an artifact is put into the preview box. An LLM
// handoff export is routinely tens of thousands of lines, and every one of
// them used to be rendered — through MarkdownRenderer, for Markdown artifacts —
// into a box that shows perhaps forty at a time. Both limits are generous
// enough that no ordinary artifact is affected; whichever is hit first wins.
const PREVIEW_MAX_LINES = 2000;
const PREVIEW_MAX_CHARS = 200_000;

// The CSS custom property `.gotsaeng-os-artifact-preview` sizes itself from.
// See the comment on syncPaneHeight.
const PANE_HEIGHT_VARIABLE = "--gotsaeng-os-pane-height";

// A command failure recorded by `runSafely` (main.ts). Carries enough to
// distinguish "the run that just happened" from a stale failure from 40
// minutes ago (see the error-banner dismiss/timestamp fix), instead of a bare
// pre-formatted string.
// The parts of the pane that survive a render. render() rebuilds everything
// else wholesale, but the three live regions must NOT be rebuilt: a region that
// is created and filled in the same pass was never in the accessibility tree
// before its content changed, so nothing is ever announced (see
// createLiveRegion in a11y.ts). Keeping them — and the static header — across
// renders means a message written into `status`/`error`/`filterStatus` is a
// genuine content change to a region assistive technology is already watching.
type ReportHubShell = {
  error: HTMLElement;
  status: HTMLElement;
  // The artifact filter's result count, for assistive technology only. It has
  // to live here rather than beside the filter input it describes for the same
  // reason its two siblings do — the input is inside `body`, which every render
  // empties — but the shell renders near the top of the pane, far from the
  // input. So this copy is visually hidden (see styles.css) and a plain,
  // always-visible copy of the same sentence is rendered next to the input by
  // renderArtifactFiles. Only this one is a live region; the visible one is
  // rebuilt with `body` on every render and carries no announcement semantics.
  filterStatus: HTMLElement;
  body: HTMLElement;
};

export type ReportHubLastError = {
  action: string;
  message: string;
  timestamp: number;
};

// The outcome of reading COMPILE_REPORT.json. "missing" (no compile has run
// yet) and "unreadable" (the file is there but is not a valid compile report)
// are different situations for the user, and neither is an exception: a
// malformed report used to throw out of readCurrentCompileReport() *before*
// render() had emptied contentEl, freezing the pane on stale content with the
// error visible only in the developer console.
export type CompileReportRead =
  // `generatedAt` is the ISO timestamp of the compile that produced this
  // report, or null when it could not be established (a pre-existing output
  // folder whose ARTIFACT_INDEX.json is missing or malformed — see
  // readCurrentCompileReport in main.ts). CompileReport itself carries no
  // timestamp, and adding one is a change to core's published schema rather
  // than to this adapter.
  | { status: "ok"; report: CompileReport; generatedAt: string | null }
  | { status: "missing" }
  | { status: "unreadable" };

export type ReportHubController = {
  settings: GotSaengPluginSettings;
  selectedOutputFileName: string | null;
  lastError: ReportHubLastError | null;
  compileContextPackCommand(): Promise<void>;
  generateWeeklyReviewCommand(): Promise<void>;
  exportLlmHandoffCommand(): Promise<void>;
  validateVaultSchemaCommand(): Promise<void>;
  setSelectedOutputFileName(fileName: string): void;
  readOutputFileByName(fileName: string): Promise<string | null>;
  readAllOutputFiles(): Promise<Partial<Record<string, string>>>;
  openOutputFileByName(fileName: string): Promise<void>;
  openSourceFileByPath(sourcePath: string): Promise<void>;
  readCurrentCompileReport(): Promise<CompileReportRead>;
  dismissLastError(): void;
  refreshReportHubViews(): Promise<void>;
};

/** Exported for tests: formats a `ReportHubLastError.timestamp` for display. */
export function formatErrorTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * The "Latest Compile" dateline: how long ago the compile ran plus the clock
 * time it ran at, e.g. `Compiled 5 minutes ago (2:14 PM)`. Both halves are
 * needed — the relative half is what makes stale data obvious at a glance, the
 * absolute half is what makes it checkable against anything else. Exported for
 * tests; `now` is a parameter so it has no hidden clock of its own.
 */
export function describeCompileTime(generatedAt: string | null, now: number): string {
  if (generatedAt === null) {
    return "Compile time unknown — run Compile to record one.";
  }

  const compiledAt = new Date(generatedAt);
  const compiledAtMs = compiledAt.getTime();
  if (Number.isNaN(compiledAtMs)) {
    return "Compile time unknown — run Compile to record one.";
  }

  const elapsedMs = now - compiledAtMs;
  return `Compiled ${formatElapsed(elapsedMs)} (${formatCompiledClock(compiledAt, elapsedMs)})`;
}

function formatElapsed(elapsedMs: number): string {
  // A negative elapsed time means the vault's clock and this one disagree,
  // which is not something to render as "in 3 hours".
  if (elapsedMs < MINUTE_MS) {
    return "just now";
  }

  if (elapsedMs < HOUR_MS) {
    return pluralizeAgo(Math.floor(elapsedMs / MINUTE_MS), "minute");
  }

  if (elapsedMs < DAY_MS) {
    return pluralizeAgo(Math.floor(elapsedMs / HOUR_MS), "hour");
  }

  return pluralizeAgo(Math.floor(elapsedMs / DAY_MS), "day");
}

function pluralizeAgo(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? "" : "s"} ago`;
}

// Within the last day the clock time alone is unambiguous; past that it is
// actively misleading without the date beside it.
function formatCompiledClock(compiledAt: Date, elapsedMs: number): string {
  return elapsedMs < DAY_MS
    ? compiledAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : compiledAt.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/**
 * The artifact filter's result line. Exported for tests. An empty result is
 * called out by name rather than left as a blank region, and the query is
 * quoted back so a typo is visible in the message that reports it.
 */
export function describeFilterMatches(
  matchCount: number,
  totalCount: number,
  query: string,
): string {
  return matchCount === 0
    ? `No files match "${query.trim()}".`
    : `Showing ${matchCount} of ${totalCount} files.`;
}

// Keeps the visible label at the front of the accessible name (WCAG 2.5.3,
// "Label in Name") while appending the full path the visible label usually
// abbreviates — and skips the append when the label already is the path.
function withPathSuffix(visibleLabel: string, path: string): string {
  return visibleLabel.includes(path) ? visibleLabel : `${visibleLabel} — ${path}`;
}

export class GotSaengReportHubView extends ItemView {
  override icon = "file-text";
  override navigation = false;

  // Preserved across renders so re-opening the view (or a re-render triggered
  // by an unrelated action) does not silently reset an in-progress filter.
  private artifactFilterQuery = "";

  // Label of the action currently in flight, if any. Every command action
  // (Compile, Weekly Review, LLM Handoff) calls the plugin's
  // refreshReportHubViews() partway through its own work (see main.ts),
  // which re-renders this leaf — including the button runAndRefresh is still
  // awaiting — before the outer action() promise settles. Without this field
  // surviving that render(), the rebuilt button would come back enabled with
  // its normal label, making the in-progress indicator disappear early and
  // letting the user fire a second overlapping command. render() consults
  // this field on every button it creates, so the running state survives any
  // render() call regardless of what triggered it.
  private runningActionLabel: string | null = null;

  // Announced (politely) by the status live region so the visual "Compile…"
  // running state has a spoken counterpart. Survives renders for the same
  // reason `runningActionLabel` does.
  private actionStatusMessage: string | null = null;

  // Bumped by every render() call. render() is async with a `contentEl.empty()`
  // near the top and awaits (file reads, MarkdownRenderer) further down, so two
  // renders can interleave: clicking Compile triggers refreshReportHubViews()
  // twice in quick succession (once from the command, once from openOutputFile
  // after it), and without this the first render's tail appends duplicate
  // preview/source/backlink sections onto the second render's finished DOM.
  // Same shape as main.ts's `folderChangeGeneration`: capture at entry,
  // re-check after every await, bail if a newer render has superseded this one.
  private renderGeneration = 0;

  private readonly focus = new FocusRestorer();

  // The four command buttons built by the current render, so starting a
  // command can disable all of them at once — not only on the next render.
  private actionButtons: (HTMLElement & { disabled: boolean })[] = [];

  // Built once by ensureShell() and reused by every later render; see
  // ReportHubShell.
  private shell: ReportHubShell | null = null;

  // The backlink index built by the last render that actually swept the output
  // folder, keyed by the folder it was built from. Building it means reading
  // every generated Markdown file (17 of them) and re-parsing all of it —
  // work that a render triggered by picking a different artifact to preview
  // cannot possibly change the result of, since nothing on disk moved. Only
  // that one path passes `reuseBacklinks`; every other render (a command
  // finishing, refreshReportHubViews, re-opening the view) re-sweeps, so a
  // change on disk is picked up as soon as anything but artifact selection
  // happens.
  private backlinkCache: { outputFolder: string; notes: NoteBacklinks[] } | null = null;

  // Signature of the error banner last written into shell.error, so an
  // unchanged lastError across renders doesn't rebuild (and thus re-announce,
  // via aria-live="assertive" + aria-atomic="true") the same banner every
  // time render() runs — a single command triggers two or more renders.
  private lastRenderedErrorKey: string | null = null;

  // Text last written into shell.filterStatus, for the same reason
  // `lastRenderedErrorKey` exists: the filter's `input` handler fires on every
  // keystroke, and four characters that don't change the match count would
  // otherwise re-announce one identical sentence four times.
  private lastFilterStatus = "";

  constructor(
    leaf: WorkspaceLeaf,
    private readonly controller: ReportHubController,
  ) {
    super(leaf);
  }

  override getViewType(): string {
    return GOTSAENG_REPORT_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return "GotSaeng OS";
  }

  override async onOpen(): Promise<void> {
    await this.renderSafely();
  }

  // Called by Obsidian whenever the leaf is resized, which is the only moment
  // the measured pane height can go stale.
  override onResize(): void {
    this.syncPaneHeight();
  }

  async render(options: { reuseBacklinks?: boolean } = {}): Promise<void> {
    const generation = ++this.renderGeneration;
    const read = await this.controller.readCurrentCompileReport();
    if (this.isSuperseded(generation)) {
      return;
    }

    const shell = this.ensureShell();
    this.syncPaneHeight();
    // Before anything is torn down: the focused element is about to be
    // removed from the DOM.
    this.focus.capture();

    this.writeErrorRegion(shell.error, this.controller.lastError);
    this.writeStatusRegion(this.actionStatusMessage);

    const contentEl = shell.body;
    contentEl.empty();

    // A vault that has never been compiled has nothing to put in any of the
    // sections below: the stats block, the artifact preview, its source panel
    // and the backlink list would each render their own "nothing here yet"
    // note, four competing messages around a grid of twenty buttons that all
    // lead to a fifth. The one thing to do in that state is run Compile, so
    // that is all this state offers — said once, above the buttons that do it.
    //
    // Gated on more than just the compile report's status: Validate writes
    // VALIDATION_REPORT.md without ever calling compileToOutput(), so it never
    // produces COMPILE_REPORT.json. Running Validate first (nothing else
    // compiled yet) against a hidden output folder routes back to this view
    // with the artifact it just wrote already selected — that is a real
    // artifact to show, not the empty state this pane would otherwise render
    // with no way to reach it. `selectedOutputFileName` only ever moves off
    // the default via a command completing or a click inside the artifact
    // grid this state doesn't render, so it is a reliable signal without an
    // extra file read.
    const isFirstRun =
      read.status === "missing" &&
      this.controller.selectedOutputFileName === DEFAULT_OUTPUT_ARTIFACT.fileName;
    if (isFirstRun) {
      this.renderFirstRunNote(contentEl);
    }

    const actions = contentEl.createDiv({ cls: "gotsaeng-os-action-grid" });
    this.actionButtons = [];
    this.addActionButton(actions, "Compile", () => this.controller.compileContextPackCommand());
    this.addActionButton(actions, "Weekly Review", () =>
      this.controller.generateWeeklyReviewCommand(),
    );
    this.addActionButton(actions, "LLM Handoff", () => this.controller.exportLlmHandoffCommand());
    this.addActionButton(actions, "Validate", () => this.controller.validateVaultSchemaCommand());

    if (isFirstRun) {
      // Still worth saying where the files are about to appear — it is a fact
      // about the vault, not another empty state.
      this.renderOutputSection(contentEl);
      return;
    }

    contentEl.createEl("h3", { text: "Latest Compile", cls: SECTION_HEADING_CLASS });
    if (read.status === "ok") {
      // Before the numbers, not after: the whole block is meaningless without
      // knowing whether it describes the vault as it is now or as it was last
      // month.
      contentEl.createEl("p", {
        text: describeCompileTime(read.generatedAt, Date.now()),
        cls: "gotsaeng-os-compile-time",
      });
      this.renderStats(contentEl, read.report);
    } else {
      // "missing" is reachable here now too — not only via the isFirstRun
      // early-return path above, but when some *other* artifact already
      // exists (see the isFirstRun comment) while a compile report never
      // has. That is not the same situation as a compile report that exists
      // but failed to parse, and shouldn't tell the user to "re-run" a
      // compile that was never run in the first place.
      contentEl.createEl("p", {
        text:
          read.status === "unreadable"
            ? "Compile report could not be read — re-run Compile to regenerate it."
            : "No compile report found yet. Run Compile to create one.",
        cls: "gotsaeng-os-view-note",
      });
    }

    this.renderOutputSection(contentEl);

    contentEl.createEl("h3", { text: "Context Pack Files", cls: SECTION_HEADING_CLASS });
    contentEl.createEl("p", {
      text: "Hidden folders stay out of the file explorer, but generated files can still be read here.",
      cls: "gotsaeng-os-view-note",
    });
    const selectedFileName =
      this.controller.selectedOutputFileName ?? DEFAULT_OUTPUT_ARTIFACT.fileName;
    this.renderArtifactFiles(contentEl, selectedFileName);

    await this.renderArtifactPreview(contentEl, selectedFileName, generation);
    if (this.isSuperseded(generation)) {
      return;
    }

    await this.renderBacklinks(contentEl, generation, options.reuseBacklinks === true);
  }

  // The cold-start state: one heading and one sentence, directly above the
  // command buttons. Deliberately not a section heading (see
  // SECTION_HEADING_CLASS) — on a fresh install this *is* the pane's content,
  // so it is styled as such rather than demoted alongside reference sections
  // that are not being rendered at all in this state.
  private renderFirstRunNote(parent: HTMLElement): void {
    const panel = parent.createDiv({ cls: "gotsaeng-os-first-run" });
    panel.createEl("h3", { text: "No context pack yet" });
    panel.createEl("p", {
      text: "Run Compile to scan this vault and generate the context pack. The compile stats, report previews, and backlinks appear here once it has run.",
    });
  }

  private renderOutputSection(parent: HTMLElement): void {
    const { outputFolder, outputFolderVisibility } = this.controller.settings;
    parent.createEl("h3", { text: "Output", cls: SECTION_HEADING_CLASS });
    parent.createEl("p", {
      text: `${outputFolder} (${outputFolderVisibility})`,
      cls: "gotsaeng-os-output-path",
    });
  }

  // Eleven equally-weighted tiles answered no question in particular. The
  // three that answer "is my vault healthy right now" lead in their own row;
  // the eight that describe the shape of the vault follow in a quieter one.
  // Nothing is dropped — only re-weighted.
  private renderStats(parent: HTMLElement, report: CompileReport): void {
    const health = parent.createDiv({ cls: ["gotsaeng-os-stats", "gotsaeng-os-stats-health"] });
    this.addStat(health, "Warnings", String(report.warnings.length));
    this.addStat(health, "Parse errors", String(report.parseErrors.length));
    this.addStat(health, "Contradictions", String(report.contradictionStats?.totalCandidates ?? 0));

    const details = parent.createDiv({ cls: ["gotsaeng-os-stats", "gotsaeng-os-stats-details"] });
    this.addStat(details, "Files", String(report.filesScanned));
    this.addStat(details, "Markdown", String(report.markdownFilesParsed));
    this.addStat(details, "Items", String(report.extractionStats?.totalItems ?? 0));
    this.addStat(
      details,
      "Missing updated",
      String(report.sourceCoverage?.notesMissingUpdated ?? 0),
    );
    this.addStat(
      details,
      "Avg provenance",
      String(report.provenanceStats?.averageScore ?? 0),
      "How well items cite a source. 0–100; higher is better.",
    );
    this.addStat(details, "Weak provenance", String(report.provenanceStats?.weakItems ?? 0));
    this.addStat(
      details,
      "Avg confidence",
      String(report.confidenceStats?.averageScore ?? 0),
      "How certain each item's wording reads. 0–100; higher is better.",
    );
    this.addStat(details, "Low confidence", String(report.confidenceStats?.lowItems ?? 0));
  }

  // Publishes the leaf's own height so the artifact preview can be capped
  // against the pane instead of the window. CSS alone cannot see this box: a
  // container query unit (`cqh`) needs `container-type: size` on an ancestor,
  // which would make this pane's height independent of its content — a
  // decision that belongs to Obsidian's own layout, not to a plugin (see
  // styles.css). A height of 0 means the element is not laid out (a detached
  // element, or a test environment with no layout engine), which is not a
  // measurement worth publishing.
  private syncPaneHeight(): void {
    const { clientHeight } = this.contentEl;
    if (clientHeight <= 0) {
      return;
    }

    this.contentEl.style.setProperty(PANE_HEIGHT_VARIABLE, `${clientHeight}px`);
  }

  // True once a later render() call has started: everything this render was
  // about to append belongs to a DOM tree that no longer exists.
  private isSuperseded(generation: number): boolean {
    return generation !== this.renderGeneration;
  }

  // Builds the persistent parts of the pane on first render, and rebuilds them
  // only if something else has emptied contentEl underneath us (renderDegraded
  // does exactly that). Everything render() rebuilds goes into `body`; the two
  // live regions stay put so a message landing in one is a change to a region
  // that was already in the accessibility tree.
  private ensureShell(): ReportHubShell {
    const { contentEl } = this;
    const existing = this.shell;
    if (existing !== null && existing.body.parentElement === contentEl) {
      return existing;
    }

    contentEl.empty();
    contentEl.addClass("gotsaeng-os-report-view");
    contentEl.createEl("h2", { text: "GotSaeng OS" });
    contentEl.createEl("p", {
      text: "Local context compiler for the current vault.",
      cls: "gotsaeng-os-view-note",
    });

    const shell: ReportHubShell = {
      error: createLiveRegion(contentEl, "gotsaeng-os-error-region", "assertive"),
      status: createLiveRegion(contentEl, "gotsaeng-os-status-region", "polite"),
      filterStatus: createLiveRegion(contentEl, "gotsaeng-os-artifact-filter-status", "polite"),
      body: contentEl.createDiv({ cls: "gotsaeng-os-report-body" }),
    };
    this.shell = shell;
    // A freshly created region is empty regardless of what was last painted
    // into its predecessor, so the identical-content guards must forget it here.
    this.lastRenderedErrorKey = null;
    this.lastFilterStatus = "";
    return shell;
  }

  // Writes straight into the live region rather than only recording state for
  // the next render to pick up. "Compile started." reached the DOM on the next
  // render, which for most commands is the same render that already carries
  // "finished" — so the two announcements arrived back to back and there was no
  // in-progress signal at all.
  private writeStatusRegion(message: string | null): void {
    const region = this.shell?.status;
    if (region === undefined) {
      return;
    }

    if ((region.textContent ?? "") === (message ?? "")) {
      // Re-writing identical text would re-announce it on every render.
      return;
    }

    if (message === null) {
      region.empty();
      return;
    }

    region.setText(message);
  }

  // The artifact filter's result count, written into the persistent region
  // built by ensureShell(). Guarded the same way writeStatusRegion is, and for
  // a sharper version of the same reason: this one is driven by an `input`
  // handler, so typing four characters that leave the match count alone would
  // re-announce one unchanged sentence four times.
  private writeFilterStatusRegion(message: string): void {
    const region = this.shell?.filterStatus;
    if (region === undefined || message === this.lastFilterStatus) {
      return;
    }

    this.lastFilterStatus = message;
    if (message === "") {
      region.empty();
      return;
    }

    region.setText(message);
  }

  // Mirrors writeStatusRegion's identical-content guard: rebuilding the
  // banner from the same lastError on every render would re-announce it
  // (aria-live="assertive" + aria-atomic="true") each time, interrupting
  // the screen reader mid-read for content that hasn't actually changed.
  private writeErrorRegion(region: HTMLElement, lastError: ReportHubLastError | null): void {
    const key =
      lastError === null ? null : `${lastError.action} ${lastError.message} ${lastError.timestamp}`;
    if (key === this.lastRenderedErrorKey) {
      return;
    }

    this.lastRenderedErrorKey = key;
    region.empty();
    if (lastError !== null) {
      this.renderErrorBanner(region, lastError);
    }
  }

  private setActionStatus(message: string | null): void {
    this.actionStatusMessage = message;
    this.writeStatusRegion(message);
  }

  // Renders (from any trigger) are fire-and-forget from the DOM's point of
  // view, so a failure part-way through leaves a half-built pane *and* an
  // unhandled rejection. Route every render through here instead of calling
  // render() directly, including where the caller wants to await it (see
  // onOpen and runAndRefresh) — the guard below only matters when render()
  // eventually rejects, which is unrelated to whether the caller awaits.
  //
  // render() increments `renderGeneration` synchronously as its very first
  // statement, so capturing the value it is about to claim — rather than
  // reading `renderGeneration` back after the fact — is safe: nothing else
  // can run on this single-threaded call stack between the line below and
  // the render() call it predicts.
  private renderSafely(options: { reuseBacklinks?: boolean } = {}): Promise<void> {
    const generation = this.renderGeneration + 1;
    return this.render(options).catch((error: unknown) => {
      // A later render can already have taken over — and succeeded — by the
      // time an EARLIER render's promise rejects (renders overlap; that is
      // the whole reason renderGeneration exists). Falling back to the
      // degraded state here regardless would wipe out that newer, valid
      // render to report a failure that is no longer current.
      if (!this.isSuperseded(generation)) {
        this.renderDegraded(error);
      }
    });
  }

  private safeRender(options: { reuseBacklinks?: boolean } = {}): void {
    void this.renderSafely(options);
  }

  private renderDegraded(error: unknown): void {
    logViewError("failed to render the Report Hub", error);
    const { contentEl } = this;
    // The persistent shell goes with it; the next successful render rebuilds
    // one rather than writing into regions that are no longer in the document.
    this.shell = null;
    contentEl.empty();
    contentEl.createEl("h2", { text: "GotSaeng OS" });
    const region = createLiveRegion(contentEl, "gotsaeng-os-error-region", "assertive");
    region.createDiv({ cls: "gotsaeng-os-error-banner" }).createEl("span", {
      text: "The Report Hub could not be rendered. Run Compile to regenerate the output files.",
      cls: "gotsaeng-os-error-banner-message",
    });
  }

  private addActionButton(parent: HTMLElement, label: string, action: () => Promise<void>): void {
    const button = parent.createEl("button", { text: label, cls: "gotsaeng-os-button" });
    this.actionButtons.push(button);
    if (this.runningActionLabel !== null) {
      // Every command writes into the same output directory, so a second one
      // started while the first is in flight interleaves its writes with the
      // first's. Disabling only the clicked button left the other three live
      // (the mid-flight re-render rebuilt them enabled), so the running state
      // is exclusive: all four disabled, only the running one relabelled.
      button.disabled = true;
      if (this.runningActionLabel === label) {
        this.applyRunningState(button, label);
      }
    }
    button.addEventListener("click", () => {
      // runAndRefresh's own try/catch/finally handles every failure that can
      // reach it (the command itself, and its closing render via
      // renderSafely) without rejecting, so there is nothing left for a
      // caller here to catch.
      void this.runAndRefresh(button, label, action);
    });
    this.focus.register(actionFocusKey(label), button);
  }

  private applyRunningState(button: HTMLElement & { disabled: boolean }, label: string): void {
    button.disabled = true;
    button.addClass("is-running");
    button.setAttr("aria-busy", "true");
    button.setText(`${label}…`);
  }

  // Explicitly undoes applyRunningState rather than relying on the re-render
  // that follows to discard the element: `aria-busy="true"` on a button an
  // assistive technology is still holding a reference to has to be cleared,
  // not merely thrown away.
  private setActionButtonsDisabled(disabled: boolean): void {
    for (const actionButton of this.actionButtons) {
      actionButton.disabled = disabled;
    }
  }

  private clearRunningState(button: HTMLElement & { disabled: boolean }, label: string): void {
    button.disabled = false;
    button.removeClass("is-running");
    button.setAttr("aria-busy", "false");
    button.setText(label);
  }

  private renderErrorBanner(parent: HTMLElement, lastError: ReportHubLastError): void {
    const banner = parent.createDiv({ cls: "gotsaeng-os-error-banner" });
    banner.createEl("span", {
      text: `${lastError.action} · ${formatErrorTimestamp(lastError.timestamp)}`,
      cls: "gotsaeng-os-error-banner-meta",
    });
    banner.createEl("span", {
      text: lastError.message,
      cls: "gotsaeng-os-error-banner-message",
    });

    const dismissButton = banner.createEl("button", {
      text: "×",
      cls: "gotsaeng-os-error-banner-dismiss",
      attr: { "aria-label": "Dismiss error", type: "button" },
    });
    // Clears independently of running another command — the banner previously
    // stuck around until the *next successful run of any command*, which a
    // user just browsing other reports (which never fail) had no way to
    // trigger while still reading the error. `lastError` is shared plugin
    // state, not per-leaf, so a workspace with multiple Report Hub leaves
    // open needs every leaf refreshed, not just the one the click happened
    // in — otherwise the other leaves keep showing a banner for an error
    // that has already been dismissed.
    dismissButton.addEventListener("click", () => {
      this.controller.dismissLastError();
      // refreshReportHubViews() calls every open leaf's render() — including
      // this one's, synchronously within that call — before returning a
      // Promise.all. Predicting this leaf's generation the same way
      // renderSafely does still applies here: a rejection surfacing later
      // must not degrade this leaf if a newer render of it has since
      // succeeded (whether that render came from this dismiss or from
      // something else entirely).
      const generation = this.renderGeneration + 1;
      void this.controller.refreshReportHubViews().catch((error: unknown) => {
        if (!this.isSuperseded(generation)) {
          this.renderDegraded(error);
        }
      });
    });
  }

  // Renders the "Context Pack Files" artifact grid: a filter input above
  // grouped buttons. Filtering toggles button/heading visibility in place
  // (via HTMLElement.toggle) rather than going through a full `render()`, so
  // the input keeps DOM identity (and focus) across keystrokes.
  private renderArtifactFiles(parent: HTMLElement, selectedFileName: string): void {
    const filterInput = parent.createEl("input", {
      cls: "gotsaeng-os-artifact-filter",
      attr: {
        type: "search",
        placeholder: "Filter files by name…",
        "aria-label": "Filter context pack files",
      },
    });
    filterInput.value = this.artifactFilterQuery;
    this.focus.register("artifact-filter", filterInput);

    // The visible half of the match count, directly under the input that
    // produces it. Its screen-reader counterpart is the live region in the
    // shell (see ReportHubShell.filterStatus), which is pinned near the top of
    // the pane and so cannot also serve as the visual feedback. This element is
    // re-created with the rest of `body` on every render and written to
    // synchronously below, so it needs no live-region machinery of its own.
    // `aria-hidden` because it is a duplicate of the shell's live region, not
    // an additional source of information — without it, a screen reader would
    // read the same sentence twice: once here (out of the live region's
    // announce path but still in the accessibility tree by default) and once
    // when the live region announces it.
    const filterCount = parent.createEl("p", {
      cls: "gotsaeng-os-artifact-filter-count",
      attr: { "aria-hidden": "true" },
    });

    const sections: {
      heading: HTMLElement;
      grid: HTMLElement;
      entries: { button: HTMLElement; label: string }[];
    }[] = [];

    for (const section of ARTIFACT_GROUPS) {
      const headingId = `gotsaeng-os-artifact-group-${section.group}`;
      const heading = parent.createEl("h4", {
        text: section.label,
        cls: "gotsaeng-os-artifact-group-heading",
        attr: { id: headingId },
      });
      const grid = parent.createDiv({
        cls: "gotsaeng-os-artifact-grid",
        attr: { role: "group", "aria-labelledby": headingId },
      });
      const entries = section.artifacts.map((artifact) => ({
        button: this.addArtifactButton(grid, artifact, selectedFileName),
        label: artifact.label,
      }));
      sections.push({ heading, grid, entries });
    }

    const totalCount = sections.reduce((total, section) => total + section.entries.length, 0);

    const applyArtifactFilter = (query: string): void => {
      this.artifactFilterQuery = query;
      const needle = query.trim().toLowerCase();
      let matchCount = 0;
      for (const { heading, grid, entries } of sections) {
        let visibleCount = 0;
        for (const { button, label } of entries) {
          const matches = needle === "" || label.toLowerCase().includes(needle);
          button.toggle(matches);
          if (matches) {
            visibleCount += 1;
          }
        }
        heading.toggle(visibleCount > 0);
        grid.toggle(visibleCount > 0);
        matchCount += visibleCount;
      }

      // Nothing to report while the filter is empty: the grid below is then
      // simply the whole list, and a permanent "20 of 20 files" is noise the
      // status region would announce for no reason.
      const message = needle === "" ? "" : describeFilterMatches(matchCount, totalCount, query);
      this.writeFilterStatusRegion(message);
      filterCount.setText(message);
    };

    filterInput.addEventListener("input", () => applyArtifactFilter(filterInput.value));
    applyArtifactFilter(this.artifactFilterQuery);
  }

  private addArtifactButton(
    parent: HTMLElement,
    artifact: OutputArtifact,
    selectedFileName: string,
  ): HTMLElement {
    const isActive = artifact.fileName === selectedFileName;
    const button = parent.createEl("button", {
      text: artifact.label,
      cls: "gotsaeng-os-artifact-button",
      attr: { "aria-pressed": String(isActive) },
    });
    if (isActive) {
      button.addClass("is-active");
    }
    button.addEventListener("click", () => {
      this.controller.setSelectedOutputFileName(artifact.fileName);
      // Picking a different file to preview changes nothing about which source
      // notes the generated reports reference, so this render reuses the
      // backlink index rather than re-reading every output file (see
      // `backlinkCache`).
      this.safeRender({ reuseBacklinks: true });
    });
    this.focus.register(`artifact:${artifact.fileName}`, button);
    return button;
  }

  // `hint` is for the metrics whose name doesn't say what the number means or
  // which direction is good — rendered as visible text rather than a `title`,
  // which needs a mouse hover and is not reliably exposed to assistive
  // technology.
  private addStat(parent: HTMLElement, label: string, value: string, hint?: string): void {
    const stat = parent.createDiv({ cls: "gotsaeng-os-stat" });
    stat.createEl("span", { text: label, cls: "gotsaeng-os-stat-label" });
    stat.createEl("strong", { text: value });
    if (hint !== undefined) {
      stat.createEl("span", { text: hint, cls: "gotsaeng-os-stat-hint" });
    }
  }

  // Disables the clicked button for the duration of the async command so a
  // user can't fire overlapping compiles by clicking repeatedly, and swaps
  // its label/aria-busy so a slow command reads as "running", not just
  // "disabled and maybe broken". `runningActionLabel` is set for the whole
  // duration of action(), not just this call's disabled flag, because
  // action() itself triggers a mid-flight refreshReportHubViews() render()
  // that rebuilds this button — addActionButton re-applies the running state
  // to the new element as long as runningActionLabel still matches. Clearing
  // the field and calling render() once more after action() settles restores
  // the normal label/enabled state without any other explicit teardown.
  private async runAndRefresh(
    button: HTMLElement & { disabled: boolean },
    label: string,
    action: () => Promise<void>,
  ): Promise<void> {
    if (button.disabled || this.runningActionLabel !== null) {
      return;
    }

    this.runningActionLabel = label;
    // Record where focus belongs BEFORE anything blurs it. Disabling a focused
    // button blurs it, so by the time the next render's focus.capture() runs,
    // document.activeElement is already <body> and there is no key left to
    // find — focus restoration for these four buttons was a silent no-op.
    this.focus.request(actionFocusKey(label));
    // Announced now, not merely recorded for the next render to emit: that
    // render is usually the one already carrying "finished".
    this.setActionStatus(`${label} started.`);
    // Immediately, not just from the next render on: the first render a
    // command triggers happens well after its work has started.
    this.setActionButtonsDisabled(true);
    this.applyRunningState(button, label);
    try {
      await action();
      // Every real command routes through main.ts's runSafely(), which
      // catches the command's own failures, records them as
      // `controller.lastError`, and resolves normally rather than
      // rejecting — that guarantee is what keeps one failed command from
      // becoming an unhandled rejection for a caller that discards its
      // promise. It also means `action()` resolving here is not proof the
      // command succeeded: without this check, a real failure announced
      // "finished." in this polite region while the error region reported
      // the same failure, telling an assistive-technology user two
      // contradictory things about the same command.
      this.setActionStatus(
        this.controller.lastError !== null ? `${label} failed.` : `${label} finished.`,
      );
    } catch (error) {
      logViewError(`${label} failed`, error);
      this.setActionStatus(`${label} failed.`);
    } finally {
      this.runningActionLabel = null;
      this.clearRunningState(button, label);
      this.setActionButtonsDisabled(false);
      // renderSafely, not render() directly: this final render can still
      // reject (a malformed COMPILE_REPORT.json read is possible right up to
      // the last render's isSuperseded check), and letting that escape here
      // would turn a contained rendering failure into an unhandled rejection
      // for the click handler below, which no longer catches one.
      await this.renderSafely();
    }
  }

  private async renderArtifactPreview(
    parent: HTMLElement,
    fileName: string,
    generation: number,
  ): Promise<void> {
    const artifact =
      ARTIFACT_GROUPS.flatMap((section) => section.artifacts).find(
        (item) => item.fileName === fileName,
      ) ?? DEFAULT_OUTPUT_ARTIFACT;
    const filePath = `${this.controller.settings.outputFolder}/${artifact.fileName}`;

    parent.createEl("h3", { text: artifact.label, cls: SECTION_HEADING_CLASS });
    parent.createEl("p", {
      text: filePath,
      cls: "gotsaeng-os-output-path",
    });

    const content = await this.controller.readOutputFileByName(artifact.fileName);
    if (this.isSuperseded(generation)) {
      return;
    }

    if (content === null) {
      parent.createEl("p", {
        text: `No ${artifact.fileName} file found yet. Run the matching command or Compile first.`,
        cls: "gotsaeng-os-view-note",
      });
      return;
    }

    this.renderSourceLinks(
      parent,
      extractSourceLinks(content, { outputFolder: this.controller.settings.outputFolder }),
    );

    // Capped before anything renders it: the JSON branch pretty-prints (which
    // can multiply the file's size several times over) and the Markdown branch
    // hands the whole string to MarkdownRenderer, which parses and builds DOM
    // for every line of it — inside a box that shows a screenful at a time.
    const slice = capPreviewContent(artifact.format === "json" ? formatJson(content) : content);
    if (slice.truncated) {
      this.renderTruncationNote(parent, artifact, slice);
    }

    const preview = parent.createDiv({ cls: "gotsaeng-os-artifact-preview" });
    if (artifact.format === "json") {
      preview.createEl("pre").createEl("code", { text: slice.text });
      return;
    }

    await MarkdownRenderer.render(this.app, slice.text, preview, filePath, this);
  }

  private renderTruncationNote(
    parent: HTMLElement,
    artifact: OutputArtifact,
    slice: PreviewSlice,
  ): void {
    const note = parent.createDiv({ cls: "gotsaeng-os-preview-truncation" });
    // A single line longer than the character budget is cut mid-line (see
    // capPreviewContent), so shownLines still equals totalLines even though
    // real content was dropped — "Showing the first N of N lines" would read
    // as complete. Report the character cut instead in that case.
    note.createEl("span", {
      text:
        slice.shownLines === slice.totalLines
          ? `Showing the first ${slice.text.length.toLocaleString()} characters of this line.`
          : `Showing the first ${slice.shownLines} of ${slice.totalLines} lines.`,
    });
    const openButton = note.createEl("button", {
      text: `Open ${artifact.fileName}`,
      attr: { type: "button" },
    });
    openButton.addEventListener("click", () => {
      void this.controller.openOutputFileByName(artifact.fileName).catch((error: unknown) => {
        logViewError(`failed to open output file ${artifact.fileName}`, error);
      });
    });
  }

  private async renderBacklinks(
    parent: HTMLElement,
    generation: number,
    reuseCached: boolean,
  ): Promise<void> {
    parent.createEl("h3", { text: "Backlinks", cls: SECTION_HEADING_CLASS });
    parent.createEl("p", {
      text: "Source notes referenced across every generated report, most-referenced first.",
      cls: "gotsaeng-os-view-note",
    });

    const backlinks = await this.buildBacklinks(generation, reuseCached);
    if (backlinks === null) {
      return;
    }

    if (backlinks.length === 0) {
      parent.createEl("p", {
        text: "No source-note backlinks found yet. Run Compile first.",
        cls: "gotsaeng-os-view-note",
      });
      return;
    }

    const list = parent.createDiv({ cls: "gotsaeng-os-backlink-list" });
    for (const note of backlinks) {
      this.addBacklinkEntry(list, note);
    }
  }

  // Returns null when a newer render has superseded this one — the caller has
  // nothing left to append to.
  private async buildBacklinks(
    generation: number,
    reuseCached: boolean,
  ): Promise<NoteBacklinks[] | null> {
    if (this.isSuperseded(generation)) {
      return null;
    }

    const { outputFolder } = this.controller.settings;
    const cached = this.backlinkCache;
    if (reuseCached && cached !== null && cached.outputFolder === outputFolder) {
      return cached.notes;
    }

    const files = await this.controller.readAllOutputFiles();
    if (this.isSuperseded(generation)) {
      return null;
    }

    const notes = buildBacklinkIndex(files, { outputFolder }).slice(0, BACKLINK_NOTE_LIMIT);
    this.backlinkCache = { outputFolder, notes };
    return notes;
  }

  private addBacklinkEntry(parent: HTMLElement, note: NoteBacklinks): void {
    const entry = parent.createDiv({ cls: "gotsaeng-os-backlink-entry" });
    const visibleLabel = `${note.label} (${note.totalCount})`;
    const button = entry.createEl("button", {
      text: visibleLabel,
      cls: "gotsaeng-os-backlink-note-button",
    });
    // The full path was reachable only by hovering for the `title` tooltip,
    // which needs a mouse and which screen readers announce inconsistently (or
    // not at all). The accessible name carries it directly, and still leads
    // with the visible text so speaking the label out loud still matches what
    // is on screen.
    button.title = note.path;
    button.setAttr("aria-label", withPathSuffix(visibleLabel, note.path));
    button.addEventListener("click", () => {
      void this.controller.openSourceFileByPath(note.path).catch((error: unknown) => {
        logViewError(`failed to open source note ${note.path}`, error);
      });
    });

    entry.createEl("p", {
      text: note.reports
        .slice(0, BACKLINK_REPORT_LIMIT)
        .map((report) => (report.count > 1 ? `${report.label} (${report.count})` : report.label))
        .join(", "),
      cls: "gotsaeng-os-backlink-reports",
    });
  }

  private renderSourceLinks(parent: HTMLElement, sourceLinks: SourceLink[]): void {
    const panel = parent.createDiv({ cls: "gotsaeng-os-source-panel" });
    panel.createEl("h4", { text: "Source Notes" });

    if (sourceLinks.length === 0) {
      panel.createEl("p", {
        text: "No source-note links found in this preview.",
        cls: "gotsaeng-os-view-note",
      });
      return;
    }

    const grid = panel.createDiv({ cls: "gotsaeng-os-source-grid" });
    for (const sourceLink of sourceLinks) {
      const visibleLabel = formatSourceLinkLabel(sourceLink);
      const button = grid.createEl("button", {
        text: visibleLabel,
        cls: "gotsaeng-os-source-button",
      });
      // See addBacklinkEntry: `title` alone is mouse-only.
      button.title = sourceLink.path;
      button.setAttr("aria-label", withPathSuffix(visibleLabel, sourceLink.path));
      button.addEventListener("click", () => {
        void this.controller.openSourceFileByPath(sourceLink.path).catch((error: unknown) => {
          logViewError(`failed to open source note ${sourceLink.path}`, error);
        });
      });
    }
  }
}

/** The stable focus identity of a command action button (see FocusRestorer). */
function actionFocusKey(label: string): string {
  return `action:${label}`;
}

function logViewError(context: string, error: unknown): void {
  console.error(`GotSaeng OS Report Hub: ${context}`, error);
}

/** What {@link capPreviewContent} decided to render, and what it left out. */
export type PreviewSlice = {
  /** The prefix of the content that is rendered. */
  text: string;
  truncated: boolean;
  /** Lines in `text`; equal to `totalLines` when nothing was dropped. */
  shownLines: number;
  /** Lines in the full content. */
  totalLines: number;
};

/**
 * Takes the leading slice of `content` that fits both limits, cutting on a line
 * boundary so the preview never ends mid-line. Exported for tests.
 */
export function capPreviewContent(
  content: string,
  maxLines: number = PREVIEW_MAX_LINES,
  maxChars: number = PREVIEW_MAX_CHARS,
): PreviewSlice {
  // Every file on disk ends in a trailing "\n"; splitting on it as-is would
  // count one phantom extra (empty) line and make an exactly-maxLines file
  // report as "showing N of N+1 lines". Strip exactly one so line counts and
  // the truncated comparison below reflect the file's real lines.
  const normalized = content.endsWith("\n") ? content.slice(0, -1) : content;
  const lines = normalized.split("\n");
  const totalLines = lines.length;
  let text = lines.slice(0, maxLines).join("\n");

  if (text.length > maxChars) {
    const clipped = text.slice(0, maxChars);
    const lastLineBreak = clipped.lastIndexOf("\n");
    // A single line longer than the character budget has no boundary to cut
    // on, so it is cut mid-line rather than dropped entirely.
    text = lastLineBreak > 0 ? clipped.slice(0, lastLineBreak) : clipped;
  }

  const truncated = text.length < normalized.length;
  return {
    text,
    truncated,
    shownLines: truncated ? text.split("\n").length : totalLines,
    totalLines,
  };
}

function formatJson(content: string): string {
  try {
    return JSON.stringify(JSON.parse(content), null, 2);
  } catch {
    return content;
  }
}

function formatSourceLinkLabel(sourceLink: SourceLink): string {
  return sourceLink.count > 1 ? `${sourceLink.label} (${sourceLink.count})` : sourceLink.label;
}
