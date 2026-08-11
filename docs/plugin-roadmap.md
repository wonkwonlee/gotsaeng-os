# Obsidian Plugin Roadmap

The adapter provides source-grouped memory diff output, calibrated provenance summaries, and
contradiction-aware Obsidian navigation.

The adapter remains framework-first: it calls `packages/core` for scanning, parsing, extraction,
stale detection, compilation, and Markdown/JSON export. It should not grow a second compiler inside
the plugin.

## Current Commands

- Compile Context Pack
- Generate Weekly Review
- Export LLM Handoff
- Validate Vault Schema
- Open Report Hub
- Switch Output Folder to Hidden
- Switch Output Folder to Visible

## Current Behavior

- Runs only on Obsidian desktop because it needs the local file-system vault path.
- Writes generated files into `.gotsaeng/context-pack` by default.
- Can switch generated files to the visible `Gotsaeng/Context Pack` folder from plugin settings.
- Writes `REPORT_HUB.md` with Obsidian wikilinks back to source notes.
- Provides a Report Hub view with command buttons, generated report shortcuts, latest compile
  metrics, direct output previews, and a ribbon icon.
- Previews `MEMORY_DIFF.md` and `CONTEXT_MANIFEST.json`.
- Previews `SOURCE_PROVENANCE.md`.
- Previews `CONFIDENCE.md`.
- Previews `CONTRADICTIONS.md`.
- Previews `ENGINEERING_OPS.md` and `TEAM_MEMORY.md`.
- Extracts source-note links from generated Markdown and JSON previews and shows source-note
  buttons that open the original vault notes.
- Shows a Backlinks section below the preview that aggregates source-note references across every
  generated report, grouped by note and ranked by total reference count.
- Validates settings input (custom output folder path, stale-day threshold) with an in-app warning
  banner and inline notices, and lets output-folder visibility be switched from the command palette
  as well as plugin settings.
- Infers current objective and surfaces it in core and plugin reports.
- Surfaces latest average confidence and low-confidence item counts.
- Surfaces latest contradiction candidate counts.
- Shows calibrated provenance buckets, including moderate items.
- Groups high-volume review sections by source.
- Triages warnings into parse errors, missing updated dates, and other warnings.
- Keeps generated output local to the current vault.
- Does not call LLM APIs, upload notes, sync data, collect credentials, or add telemetry.
- Ignores `.gotsaeng` and `.obsidian` folders during scanning.

## Later Research

- Cross-vault or team-wide (multi-user) engineering ops and team memory aggregation. The
  single-vault versions already ship as `ENGINEERING_OPS.md` / `TEAM_MEMORY.md` (see Current
  Behavior above).
- Optional model integrations only after explicit design and security review.
