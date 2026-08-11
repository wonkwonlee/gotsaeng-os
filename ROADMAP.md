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

- Engineering ops and team memory workflows: `ENGINEERING_OPS.md` (release-gate snapshot) and
  `TEAM_MEMORY.md` (team-facing handoff), both composed from existing renderers.
- Obsidian Report Hub Backlinks section, aggregating source-note references across every
  generated report (not just the one being previewed).
- Command-palette commands to switch the managed output folder without opening plugin settings.
- Typed `confidenceSource` field on extracted items, replacing a fragile string-match; fixed a
  register-cap bug that could drop explicit-marker items once a single register held more than 200
  of them.
- Configurable extraction- and render-time item caps via `CompileOptions.caps`.
- This track only started once the open-source production-readiness baseline went green: release
  checks, installability, contributor readiness, user trust/security audit, and local adapter
  distribution evidence.

## v0.12

- `@gotsaeng/mcp`: a stdio MCP server (workspace-only, not yet published) exposing `validate_vault`,
  `compile_context_pack`, `list_context_artifacts`, `read_context_artifact`, and
  `prepare_ai_handoff` as narrow, path-allowlisted tools over `packages/core`, so MCP clients
  (Claude Code, Codex, Cursor) can call GotSaeng OS as structured tools instead of shelling out to
  the CLI. See `docs/mcp.md` and `docs/superpowers/plans/2026-08-11-mcp-roadmap.md`.
- `ARTIFACT_INDEX.json` compile output and CLI `--json` for `compile`/`validate`, the machine-
  readable foundation the MCP server builds on.

## Known Follow-ups

- **Stale status is resolved at render time, not in the pack.** `ACTION_BACKLOG.md` derives the
  Stale section from `pack.staleItems` because `markStale` returns a copy rather than mutating the
  item. An action flagged by the stale detector therefore still reads `status: open` in
  `CONTEXT_MANIFEST.json` while appearing under `## Stale` in the backlog. Making the compiler
  apply staleness before the stats are computed would remove the inconsistency, but shifts the
  confidence and provenance snapshots, so it is deliberately deferred.

## Current Non-Goals

- SaaS, cloud sync, authentication, payments, vector databases, RAG, LLM API integrations,
  autonomous researchers, browser extensions, mobile apps, and a rich Obsidian-native management UI.
  The MCP server (`@gotsaeng/mcp`) is not an exception: it makes no LLM API calls itself and calls
  no model provider — it exposes local read/compile operations as MCP tools for a client-side agent
  to call, the same trust boundary as the CLI.
