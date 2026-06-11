# Changelog

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
