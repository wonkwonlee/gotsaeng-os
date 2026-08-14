# Changelog

## 0.12.1

- Fix: the Obsidian adapter's Report Hub settings tab and output-folder cleanup had four related
  bugs, all found during an `/impeccable` critique of `apps/obsidian-plugin` (public repo issues
  #21, #22, #25, #26):
  - Routine output-folder cleanup (every Compile/Weekly Review/LLM Handoff/Validate command) only
    ever considered the two built-in folder names as sweep candidates, regardless of whether this
    plugin instance had ever actually used them. A file reappearing in an unused built-in folder
    (e.g. from a vault sync or backup restore) was silently deleted on the next compile. Cleanup
    now sweeps only folders in a persisted `managedOutputFolders` set, populated as the user
    actually consents to output-folder changes.
  - Output-folder cleanup could delete empty ancestor directories above the managed output folder
    (walking up toward the vault root) even when the plugin did not create them. It now only ever
    removes the exact managed folder itself.
  - The custom-path text field's blur-commit and the visibility dropdown's change handler could
    race on a fast user gesture, opening two confirm modals for one logical change and reading
    settings before either had settled. Output-folder mutations are now serialized.
  - Selecting "Custom path" in the settings dropdown no longer eagerly persists
    `outputFolderVisibility: "custom"` before an actual custom folder is committed; declining the
    subsequent confirm modal now cleanly reverts instead of leaving a mismatched
    `custom` + built-in-folder state. The path field is now focused only on the transition into
    custom mode (not on every settings-tab re-render), and the validation banner refreshes
    immediately after a successful commit instead of waiting for the tab to be reopened.
  - (Codex review follow-up) A `data.json` predating `managedOutputFolders` grandfathered the
    hidden folder into that set regardless of which folder the vault actually used, reopening the
    same silent-deletion risk the field was added to close. Legacy settings now start from an empty
    managed set, plus only the folder actually in use. Serializing racing blur/dropdown calls also
    still let a fast gesture open two sequential confirm modals (the blur commit's, then the
    dropdown's, against whatever the first one left behind) instead of one; a generation counter now
    cancels a superseded queued call outright so only the most current intent ever prompts.
- Security: `writeText`/`mkdir` in every `node:fs`-backed `FileSystemAdapter` (`packages/cli`,
  `packages/mcp`, and the corresponding test helpers) now delete a pre-existing symlink at the
  target path before creating a real file/directory there, instead of writing through it.
  `fs.writeFile` follows a symlink at its final path segment; a vault (or CLI output directory)
  that already had a symlink planted at a generated artifact's predictable name (e.g.
  `.gotsaeng/context-pack/PROJECT_CONTEXT.md`) would have that symlink's target truncated and
  overwritten by a compile, corrupting whatever file or directory it pointed to outside the vault.
  `writeText` gates the removal on `lstat` (not a plain existence check, and not an unconditional
  remove): `lstat` reports the link itself rather than following it, so it also catches a
  _dangling_ symlink (target missing) that an `exists()`-style check would miss and let the write
  follow anyway — and only removing when the target is actually a symlink preserves the
  mode/permissions of a normal pre-existing file across an overwrite, instead of losing them to a
  remove-then-recreate. `apps/obsidian-plugin/src/obsidian-file-system.ts`'s `writeText` got the
  equivalent unconditional try/catch-wrapped removal (Obsidian's `DataAdapter` exposes no `lstat`
  equivalent to gate on directly, so `mkdir` there is unchanged — see its inline comment), but only
  swallows a confirmed `ENOENT` from that removal — any other failure (e.g. a symlink sitting in a
  directory this process can't write to) now aborts the write instead of falling through to
  `adapter.write()`, which would still follow whatever the failed removal left in place. None of
  this protects against a symlinked _ancestor_ directory in the output path, only the leaf artifact
  path itself; closing that fully would need validating every path segment, a separate, larger
  pass.
- Security: `.github/workflows/release.yml`'s `quality` job now retains the `obsidian-plugin-dist`
  artifact for 14 days instead of the 1-day default. The `publish` job can sit waiting on a
  required-reviewer approval (see `docs/release.md`'s "Optional: require manual approval before
  publish") for as long as the approver takes; a 1-day retention could expire the artifact mid-wait,
  so `github-release` would fail to download it after `publish` already published the (now
  immutable) npm packages, leaving the release stuck with no clean way to finish just the GitHub
  Release step.
- Security: `.github/workflows/release.yml`'s `github-release` job no longer runs `pnpm
install`/`pnpm build` itself while holding a `contents: write` token — a compromised dependency's
  install/build script running in that job could have used the checkout-persisted git credential to
  push commits or tags. It now downloads the Obsidian plugin build produced under the `quality`
  job's read-only token instead. All three jobs' `actions/checkout` steps now set
  `persist-credentials: false`.
- Security: `.github/workflows/release.yml`'s `quality` job now refuses to proceed (before
  installing any dependency or running any script) unless the pushed tag's commit is reachable from
  `origin/main` — a tag alone only proves tag-push rights, not that its target was reviewed;
  without this check, and absent separate tag protection in repo settings, anyone who could push a
  tag could point a version release at unreviewed history. `docs/release.md` also documents an
  optional additional layer: binding the `publish` job to a GitHub Environment (`release`) that can
  be configured with required-reviewer approval.
- Security: `.claude/skills/address-pr-review/SKILL.md` now checks out a PR with `gh pr checkout
<n>` instead of `git checkout <headRefName>`. A fork PR's `headRefName` is attacker-controlled,
  not globally unique (can collide with an existing local/origin branch, including `main`), and can
  contain shell metacharacters — `gh pr checkout` resolves the PR by its immutable number via the
  API instead of building a git command out of that text. Also added an explicit trust caveat,
  since the skill goes on to run this repo's own package scripts and push a commit.

- Obsidian adapter: `GotSaengSettingTab` now implements the declarative settings API
  (`getSettingDefinitions`/`getControlValue`/`setControlValue`, Obsidian >=1.13.0), so its six
  settings are searchable in Obsidian's built-in settings search. `display()` stays as the
  fallback for hosts older than 1.13.0 — `manifest.json`'s `minAppVersion` is unchanged (`1.5.0`).
  Four settings (project name, stale days, strict validation, open-after-compile) use native
  `control` definitions. The other two (output folder visibility, output folder path) use the
  `render` escape hatch instead: no `control` type exposes a blur-only commit or a
  confirm-before-persist gate, and reproducing either with a native `text`/`dropdown` control's
  per-change `setControlValue` would fire the 0.12.0 delete-confirmation dialog once per
  keystroke — exactly the regression that release fixed. Both `render` definitions share their
  actual logic with `display()` via two extracted methods, so nothing is implemented twice.
  Closes #24.
- Obsidian adapter: `apps/obsidian-plugin/tsconfig.json` now includes the `DOM` lib. Without it
  `HTMLElement` and friends resolved to TypeScript's `error` type, so every `createEl`,
  `createDiv`, and `addEventListener` call in `main.ts` and `view.ts` was silently unchecked —
  `tsc` stayed quiet because the `error` type is assignable to everything. This is what produced
  the bulk of the "unsafe member access on an `any` value" findings in the Obsidian community
  plugin scorecard for the adapter's own source. Types only; no runtime change.
- Tooling: ESLint now runs `typescript-eslint`'s `recommendedTypeChecked` rule set over all
  TypeScript, wired to the real tsconfigs via `projectService`. The `no-unsafe-*` rules that
  the scorecard reports were never active locally, so `pnpm lint` could not catch what it
  flagged. `pnpm lint` still exits 0 at `--max-warnings 0`.
- Core: validation messages for `type`, `created`, and `updated` now show the offending
  frontmatter value as JSON when it is a map or a sequence. They previously ran it through
  `String()`, which rendered any object-valued field as an unhelpful `[object Object]`.
- CLI: the `--json` payload shapes are now named types (`CompileJsonPayload`, `CliErrorJsonPayload`,
  `ValidationJsonPayload`) annotated onto the literals `packages/cli/src/output.ts` emits, so a
  drift from the documented schema is a type error. This is an internal type-safety change, not a
  new public API: `output.ts` is not re-exported from the package entry point. Output is
  byte-identical.
- Core: `packages/core` no longer imports `node:fs` (or `fast-glob`, which pulls it in) anywhere.
  Every read/write goes through a new `FileSystemAdapter` interface
  (`adapters/file-system.ts`) injected by the caller: `compileContextPack`, `writeContextPack`,
  `scanSourceFiles`/`scanMarkdownFiles`, `parseMarkdownFile`, and every exporter now take one as
  their first argument. `packages/cli` and `packages/mcp` each construct a `node:fs`-backed
  implementation (`node-file-system.ts`); `apps/obsidian-plugin` constructs one backed by
  `app.vault.adapter` instead (`obsidian-file-system.ts`), translating the same absolute,
  under-vault-root paths core has always used into the vault-relative paths Obsidian's adapter
  expects. `output-cleanup.ts` and the three remaining direct-`fs` call sites in `main.ts` (output
  read/write, compile-report read) were converted the same way. Scanning itself moved from
  fast-glob to an `adapter.list()`-based recursive walk with `micromatch` ignore-glob filtering, a
  known-`**`-suffix pruning optimization to avoid walking `.git`/`node_modules`-sized ignored
  subtrees, and explicit dotfile exclusion to preserve fast-glob's old `dot: false` behavior.
  Closes #22. `apps/obsidian-plugin/dist/main.js` also aliases `fs`/`node:fs` to a throwing stub at
  build time (`tsup.config.ts`, `scripts/fs-stub.cjs`), since `gray-matter`'s `index.js` does an
  unconditional (but, for how this plugin calls it, unreachable) top-level `require('fs')` for its
  unused `matter.read(filePath)` overload — the stub is what makes "no `node:fs` import reachable
  from the built plugin" true of the bundle as shipped, not just of this repo's own source.
  Local-only I/O throughout; no behavior change for CLI/MCP users, and Obsidian users get the same
  compiled output as before.

## 0.12.0

- MCP: added `@gotsaeng/mcp`, a stdio MCP server exposing `validate_vault`,
  `compile_context_pack`, `list_context_artifacts`, `read_context_artifact`, and
  `prepare_ai_handoff` as narrow, path-allowlisted tools over `packages/core`, for MCP clients like
  Claude Code and Codex. Published to npm — install via `npx -y @gotsaeng/mcp`. See `docs/mcp.md`.
- Core: LLM handoff rendering moved from the Obsidian adapter into `packages/core`
  (`exporters/handoff-exporter.ts`), with a `sections` option for selecting which reports a
  handoff bundles. The plugin now consumes this renderer instead of keeping its own copy.
- Core: `writeContextPack` now writes `ARTIFACT_INDEX.json`, a name/byte-size/sha256/description
  entry for every other generated file, for downstream tools that need to verify artifact
  integrity without re-reading full contents.
- CLI: `compile` and `validate` accept `--json` to print a schema-versioned JSON document on
  stdout instead of the text summary, for scripting and machine consumption.
- Obsidian adapter: every output-folder change now goes through one confirm-before-delete gate
  (`applyOutputFolderChange`), showing the exact number of GotSaeng-generated files that will be
  removed from the folder being vacated. This covers the two command-palette switch commands, all
  three settings-tab visibility options including "Custom path", and the custom-path text field —
  each of which previously had its own path to the same deletion, some with no warning at all.
  No dialog appears when there is nothing to delete.
- Obsidian adapter: leaving a _custom_ output folder now cleans up (and correctly counts) the
  generated files left behind in it. Cleanup previously only ever looked at the two built-in
  managed folders, so files in a vacated custom folder were both missing from the confirmation
  count and orphaned permanently — no later cleanup pass ever revisited that path.
- Obsidian adapter: the custom output-folder path now commits on blur rather than on every
  keystroke, matching the stale-days field and avoiding a confirmation prompt per character typed.
- Obsidian adapter: added CSS for the Backlinks section and the settings validation warning
  banner, which previously rendered as unstyled default elements — no matching rule existed in
  `styles.css` for either.
- Obsidian adapter: the Report Hub's Context Pack Files grid is now grouped into "Core Reports,"
  "Analysis," and "Raw Data" sections instead of one flat 19-button grid.
- Obsidian adapter: command failures now persist as a dismissable-on-next-success error banner in
  the Report Hub view (`GotSaengObsidianPlugin.lastError`), not just a transient Notice toast.
- Obsidian adapter: action buttons (Compile, Weekly Review, LLM Handoff, Validate) disable
  themselves while their command is in flight, preventing overlapping runs from repeated clicks.
- Obsidian adapter: the stale-days settings field now validates on blur instead of re-rendering
  the entire settings tab on every keystroke, matching the custom-output-folder field's existing
  pattern.

## 0.11.0

- Fixed `renderCappedRegisterList` dropping explicit-marker items once a single register contains
  more than 200 of them: the effective cap is now raised to fit every explicit-marker item, so only
  lower-signal items are ever trimmed. (wonkwonlee/gotsaeng-os#18)
- Replaced the string-matching used to identify explicit-marker items (substring-checking the
  `"explicit extraction marker"` confidence-signal label) with a typed `confidenceSource` field
  persisted on `ExtractedItem`. The compiler cannot catch a divergence between two free-text labels
  in different modules; a typed field is checkable and survives label rewording. (wonkwonlee/gotsaeng-os#9)
- Added a configurable `caps` option to `CompileOptions`: `caps.perHeading` overrides the
  per-heading inferred-extraction cap (extractor.ts, default 12), and `caps.register` /
  `caps.insights` override the render-time register caps (markdown-exporter.ts, default 200 / 120).
  All three are optional and independently overridable via `compileContextPack`/`writeContextPack`.
  (wonkwonlee/gotsaeng-os#10)
- Added a Backlinks section to the Obsidian Report Hub view, below the artifact preview. It reads
  every generated Markdown report, inverts the existing source-note extraction into a per-note
  index, and lists which reports reference each source note and how many times — ranked by total
  reference count. Pure aggregation over the existing `extractSourceLinks` output; no new
  extraction logic.
- Added two command-palette commands, `Switch Output Folder to Hidden` and `Switch Output Folder to
Visible`, so the managed output folder can be moved without opening plugin settings. Both reuse
  the same stale-folder cleanup the settings-tab dropdown and Compile command already rely on, so
  switching immediately removes GotSaeng-managed files left in the folder being vacated.
- Added two new generated reports. `ENGINEERING_OPS.md` is a release-gate snapshot: quality
  counts, warning triage, and the provenance/confidence/contradiction summaries in one place, plus
  the full list of generated artifacts. `TEAM_MEMORY.md` is a team-facing handoff: current
  objective, active work, decisions, risks, open questions, stale follow-up, and review-queue
  counts. Both compose existing renderers — no new extraction logic, no external calls.
- Fixed inline-link stripping in contradiction candidates: the parenthesized-URL fix shipped in
  0.10.7 was applied to the extractor but not to the duplicated cleanup in `contradictions.ts`, so
  Wikipedia-style links still leaked a trailing `)`. Both call sites now share one
  `stripLinkSyntax` helper.
- Fixed `ACTION_BACKLOG.md` never showing detector-flagged stale actions. `detectStaleItems`
  returns stale-marked copies rather than mutating `pack.actions`, so the `## Stale` section only
  ever caught items already labelled stale in the source note. The backlog now resolves staleness
  from `pack.staleItems`; `done` stays terminal.
- Marker names are escaped before being interpolated into the extraction regexes and sorted
  longest-first, so a marker containing a regex metacharacter can no longer corrupt the pattern and
  a marker cannot shadow another marker it is a prefix of.
- The Obsidian Report Hub now imports core's coverage/provenance/confidence/contradiction/
  warning-triage renderers instead of holding byte-identical copies. Generated output is unchanged.
- Removed `@gotsaeng/shared`: two branding constants that nothing imported.
- Added `pnpm check:versions`, which enforces the release version-agreement invariant that was
  previously checked by hand, and wired it plus `pnpm format:check` into CI and the clean-clone
  release smoke.
- Test coverage 73.2% → 87.5% statements. `apps/obsidian-plugin/src/main.ts` and `view.ts` went
  from untested to covered, including the vault-cleanup path that deletes files.
- No telemetry, network, or LLM calls; local-only behavior is unchanged.

## 0.10.8

- Recognized the spaced Korean action marker `할 일` (previously only `할일` was mapped), so a
  `- 할 일: …` bullet is extracted as an explicit `action`. Also hardened `classifySubheading` so
  topic keywords take precedence over the numbered-heading heuristic. (#15)
- Truncated item text now reserves room for the ellipsis so it never exceeds the 360-character cap,
  and leading `status:`/`priority:`/`!high` metadata at the very start of an item is stripped from
  the text (matching the status/priority inference). (#16)
- The CLI version is now derived from `package.json` at runtime instead of a hardcoded constant, so
  `gotsaeng --version` and `gotsaeng doctor` can never drift from the published version. (#17)
- No telemetry, network, or LLM calls; local-only behavior is unchanged.

## 0.10.7

- Fixed `ACTION_BACKLOG.md` silently dropping action items whose status is `stale`: a dedicated
  Stale section is now rendered, and the Unknown bucket is a catch-all so no status value can ever
  vanish from the backlog. (#13)
- Hardened date parsing: impossible calendar dates (e.g. `2024-13-40`, `2024-02-30`) are now
  rejected instead of silently rolling over, and the lenient locale/timezone-dependent
  `new Date(string)` fallback is replaced with a strict ISO-8601 (zoned) allow-list, removing a
  source of non-deterministic stored dates across machines. (#14)
- Fixed inline-link stripping corrupting item text when a URL contains parentheses (e.g. Wikipedia
  `.../Foo_(bar)` links no longer leak a trailing `)` into the extracted text). (#12)
- No telemetry, network, or LLM calls; local-only behavior is unchanged.

## 0.10.6

- Mapped the common vault frontmatter aliases `type: memo` and `type: note` to `research`, so notes
  using those conventions no longer fall through to the low-confidence `unknown` type. (#1)
- Added path heuristics for `meetings/` and `interviews/` folders, classifying their notes as
  `research` instead of `unknown` to preserve extraction confidence. (#5)
- Added test coverage for Korean section-heading inference (할 일/질문 → question, 결정 → decision,
  위험 → risk, 요약/통찰 → insight) so a regression in those patterns is caught. (#4)
- No telemetry, network, or LLM calls; local-only behavior is unchanged.

## 0.10.5

- Added an optional `ignoreGlobs` compile option so the Obsidian plugin no longer re-scans its own
  visible output folder on the next compile. Previously a visible output folder (e.g.
  `Gotsaeng/Context Pack/`) was re-read as source, inflating item counts and emitting
  `Missing updated field` warnings. (#6)
- Bounded the high-volume context-pack registers. Inferred bullet extraction under a single heading
  is now capped, and every dedicated register (Risk Register, Action Backlog, Open Questions, and
  the Memory Snapshot lists) caps each list at 200 items — keeping explicitly marked items first and
  summarizing the remainder with an `... N more items omitted` footer. Output is unchanged for vaults
  within the cap; full counts remain in `COMPILE_REPORT.json`. (#7)
- Extracted item text longer than 360 characters is still truncated, but now records a warning (with
  the source path and original length) in the item's confidence metadata instead of failing
  silently. (#3)
- No telemetry, network, or LLM calls; local-only behavior is unchanged.

## 0.10.4

- Removed the plugin-name heading from the settings tab (Obsidian directory guideline: settings
  headings must not include the plugin name).
- `manifest.json` `authorUrl` now points to the maintainer profile instead of the plugin repo.
- No other behavior changes.

## 0.10.3

- Added root-level `manifest.json` and `versions.json` copies required by the Obsidian community
  directory portal (it validates the manifest at the repository root of the release tag commit).
- Includes the numbered task list extraction fix contributed in #8 (numbered prefixes like
  `1. [ ]` now match task and explicit-marker extraction).
- No other behavior changes.

## 0.10.2

- Fixed the Obsidian plugin "Custom path" output folder setting: the path field no longer
  loses focus on every keystroke (the settings pane was re-rendered per character), invalid
  intermediate input no longer spams notices (validation now runs on blur), and the field
  auto-focuses when Custom path is selected.
- No compiler behavior changes.

## 0.10.1

- Replaced README Quick Start with the exact 3-arg `npx` form required by `compile` (`--output` and `--project` are required options).
- Added README hero, badge row (npm, CI, license, Node version, local-first), and collapsed the feature list to a table with a `<details>` full list.
- Added `examples/README.md` mapping `sample-vault` → `sample-output` with an output file table and annotation format reference.
- Added `docs/public/demo.svg`: dependency-free terminal-style SVG demo from real `compile` output.
- Added `.github/workflows/release.yml` (tag-triggered, OIDC `id-token: write`, core-before-cli publish order).
- Added Node 20 + 22 matrix to `.github/workflows/ci.yml`.
- Added `@vitest/coverage-v8` dev dependency; coverage available via `pnpm test:coverage`.
- Set `packages/shared` to `"private": true`; publish set is provably `{@gotsaeng/core, @gotsaeng/cli}`.
- Added `docs/release.md` rollback runbook for half-published npm state.
- Deepened `CONTRIBUTING.md` with repo map and "how to add a new note type" walkthrough.
- No compiler behavior changes.

## 0.10.0

- Grouped `MEMORY_DIFF.md` detail sections by source note for newly added, changed, newly stale,
  and resolved context.
- Recalibrated source provenance scoring to better separate strong, moderate, and weak items.
- Added provenance calibration metadata to new scored items.
- Added `moderateItems` to `provenanceStats` and provenance summaries.

## 0.9.0

- Added deterministic contradiction, conflict, and uncertainty candidate detection.
- Added `CONTRADICTIONS.md` with review candidates, watchlist candidates, evidence, and scope notes.
- Added `contradictionStats` to `COMPILE_REPORT.json`.
- Exposed contradiction output and latest candidate counts in the Obsidian Report Hub.

## 0.8.0

- Added deterministic extraction-confidence metadata to extracted items.
- Added `CONFIDENCE.md` with confidence summary, high/low confidence items, and confidence warnings.
- Added `confidenceStats` to `COMPILE_REPORT.json`.
- Added confidence metadata to `CONTEXT_MANIFEST.json` and memory-diff change detection.
- Exposed confidence output and latest confidence stats in the Obsidian Report Hub.

## 0.7.0

- Added source-note extraction for Obsidian Report Hub previews.
- Added source-note buttons above generated Markdown and JSON previews so hidden context-pack
  output can still be audited from source notes inside Obsidian.
- Added tests for source-link extraction from Obsidian wikilinks, generated `source:` metadata, and
  `CONTEXT_MANIFEST.json` previews.

## 0.6.0

- Added deterministic source provenance scoring for extracted context items.
- Added `SOURCE_PROVENANCE.md` with summary stats, weak provenance items, strong provenance items,
  and provenance warnings.
- Added `provenanceStats` to `COMPILE_REPORT.json`.
- Added provenance metadata to `CONTEXT_MANIFEST.json` and memory-diff change detection.
- Exposed source provenance output in the Obsidian Report Hub preview list.

## 0.5.0

- Added `CONTEXT_MANIFEST.json`, a deterministic local manifest of extracted context items.
- Added `MEMORY_DIFF.md`, a human-readable diff between the previous compile manifest and the
  current compile.
- Memory diff now surfaces newly added, changed, newly stale, and resolved context without AI or
  network calls.
- Added core memory-diff schemas, renderer, writer, and tests.
- Exposed memory diff and manifest files in the Obsidian Report Hub preview list.

## 0.4.1

- Added hidden, visible, and custom output folder modes to the Obsidian adapter settings.
- Kept `.gotsaeng/context-pack` as the default hidden local output folder.
- Added direct Report Hub previews for every generated output artifact, including Markdown reports
  and `COMPILE_REPORT.json`, so hidden output can be inspected without using a code editor.
- Updated Obsidian command behavior so hidden outputs reopen the Report Hub view instead of relying
  on the file explorer.

## 0.4.0

- Added reusable core quality helpers for objective inference, source grouping, warning triage,
  and high-signal item selection.
- Improved `PROJECT_CONTEXT.md` by showing objective source, confidence, and source-grouped
  decisions, risks, and questions.
- Improved `MEMORY_SNAPSHOT.md` with warning triage so missing metadata and parse issues are easier
  to act on.
- Added structured `warningTriage` metadata to `COMPILE_REPORT.json`.
- Upgraded the Obsidian weekly review report with current objective, top focus items, grouped
  active actions, top questions, top risks, stale context, and warning triage.
- Updated `REPORT_HUB.md` to surface the inferred objective and high-signal actions/questions/risks.

## 0.3.0

- Reviewed plugin-generated local vault smoke output and confirmed the four v0.2 commands produce
  local context-pack, validation, weekly review, and LLM handoff files.
- Added `REPORT_HUB.md`, a plugin-specific Obsidian navigation report with source-note wikilinks,
  report links, compile stats, active actions, questions, risks, and metadata follow-up notes.
- Added a GotSaeng OS Obsidian report hub view with command buttons, report shortcuts, latest
  compile metrics, and a ribbon icon.
- Kept core Markdown/JSON context-pack output model-ready and unchanged; Obsidian navigation lives
  in plugin-specific reports.
- Updated plugin styles, tests, docs, and package versions for v0.3.0.

## 0.2.0

- Added the desktop-only Obsidian adapter scaffold in `apps/obsidian-plugin`.
- Added Obsidian commands for Compile Context Pack, Generate Weekly Review, Export LLM Handoff,
  and Validate Vault Schema.
- Added local plugin settings for project name, output folder, stale threshold, strict validation,
  and opening generated files.
- Added generated Obsidian reports for validation, weekly review context, and LLM handoff export.
- Bundled `@gotsaeng/core` into the plugin build while keeping `obsidian` external.
- Ignored `.obsidian` and `.gotsaeng` folders during core scans to avoid compiling plugin internals
  or prior generated output.
- Updated docs, roadmap, and package versions for v0.2.0.

## 0.1.2

- Added context quality reporting through `extractionStats` and `sourceCoverage` in
  `COMPILE_REPORT.json`.
- Added source coverage lines to `MEMORY_SNAPSHOT.md`.
- Added high-volume section caps for generated Markdown views, with omitted-item notices that point
  to `COMPILE_REPORT.json` totals.
- Reduced inferred-extraction noise from system workflow docs, archive docs, templates, and
  repository assistant instruction files.
- Preserved underscores in extracted text so filenames such as `PROJECT_CONTEXT.md` remain stable.

## 0.1.1

- Added compatibility-mode validation for real Obsidian vaults.
- Added `gotsaeng validate --strict` for canonical schema enforcement.
- Added custom note type mapping for common vault values such as `wiki`, `source`, `reflection`,
  `weekly`, `monthly`, and `conversation`.
- Added deterministic inferred extraction for plain Obsidian task lists.
- Added deterministic inferred extraction from common sections such as `Summary`, `Key Points`,
  `Open Questions / TODO`, `Contradictions / Uncertainty`, and source metadata.
- Added Korean marker aliases such as `질문`, `결정`, `위험`, `가정`, `통찰`, and `사실`.

## 0.1.0

- Established the initial pnpm TypeScript monorepo for GotSaeng OS.
- Added `@gotsaeng/core` with Markdown scanning, YAML frontmatter parsing, note classification,
  explicit marker extraction, stale context detection, context-pack compilation, and Markdown/JSON
  exporters.
- Added `@gotsaeng/cli` with `compile`, `validate`, and `doctor` commands.
- Added a polished sample vault and checked sample context-pack output.
- Added snapshot tests for generated Markdown and JSON output.
- Added public OSS project files, CI, security notes, architecture docs, and roadmap docs.

### Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm lint`

### Security and Privacy

v0.1 is local-only. It does not add telemetry, hidden network calls, credential collection, cloud
sync, remote execution, or LLM API calls.
