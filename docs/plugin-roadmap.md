# Obsidian Plugin Roadmap

v0.10 adds source-grouped memory diff output and calibrated provenance summaries on top of
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
- Extracts source-note links from generated Markdown and JSON previews and shows source-note
  buttons that open the original vault notes.
- Infers current objective and surfaces it in core and plugin reports.
- Surfaces latest average confidence and low-confidence item counts.
- Surfaces latest contradiction candidate counts.
- Shows calibrated provenance buckets, including moderate items.
- Groups high-volume review sections by source.
- Triages warnings into parse errors, missing updated dates, and other warnings.
- Keeps generated output local to the current vault.
- Does not call LLM APIs, upload notes, sync data, collect credentials, or add telemetry.
- Ignores `.gotsaeng` and `.obsidian` folders during scanning.

## v0.11 Candidates

- Improve settings validation and user-facing error states.
- Add source-note backlink sections grouped by note.
- Add command palette affordances for project-specific output folders.

## Later Research

- Engineering ops and team memory workflows.
- Optional model integrations only after explicit design and security review.
