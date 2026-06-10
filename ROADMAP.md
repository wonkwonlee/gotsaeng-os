# Roadmap

## v0.1

- Local Markdown context compiler.
- CLI-first workflow.
- Deterministic extraction from explicit markers.
- Markdown and JSON context-pack output.
- Stale context detection using dates and open actions.

## v0.2

- Desktop-only Obsidian plugin adapter.
- Adapter commands for compile, weekly review, LLM handoff, and validation.
- Local vault output under `.gotsaeng/context-pack`.
- Scanner ignores for `.obsidian` and `.gotsaeng`.

## v0.3

- Obsidian Report Hub and source-note navigation.

## v0.4

- Objective inference.
- Source grouping in high-volume outputs.
- Warning triage in Markdown and JSON reports.
- High-signal weekly review output.

## v0.4.1

- Hidden output remains the default under `.gotsaeng/context-pack`.
- Plugin settings can switch output to the visible `Gotsaeng/Context Pack` folder.
- Report Hub previews generated Markdown and JSON artifacts directly, including hidden output.

## v0.5

- Deterministic local context manifest.
- Memory diff between previous and current compile output.
- Newly added, changed, newly stale, and resolved context sections.
- Obsidian Report Hub previews for memory diff and manifest output.

## v0.6

- Deterministic source provenance scoring.
- Source provenance report and compile report aggregate stats.
- Provenance metadata in context manifest and memory diff changed fields.
- Obsidian Report Hub preview for source provenance output.

## v0.7

- Source-aware preview navigation inside the Obsidian Report Hub view.
- Source-note buttons extracted from generated Markdown and JSON previews.
- Hidden output remains auditable from inside Obsidian without exposing `.gotsaeng` in the file
  explorer.

## v0.8

- Confidence metadata.

## v0.9

- Deterministic contradiction, conflict, and uncertainty candidate report.

## v0.10

- Source-grouped memory diff output and calibrated provenance scoring.

## v0.11

- Engineering ops and team memory workflows.
- Start this track only after the open-source production-readiness baseline is green: release
  checks, installability, contributor readiness, user trust/security audit, and local adapter
  distribution evidence.

## Current Non-Goals

- SaaS, cloud sync, authentication, payments, vector databases, RAG, LLM API integrations,
  autonomous researchers, browser extensions, mobile apps, and a rich Obsidian-native management UI.
