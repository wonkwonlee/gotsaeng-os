# Architecture

GotSaeng OS is a CLI-first context compiler with a desktop-only Obsidian adapter and report hub,
plus an MCP stdio adapter (`packages/mcp`, `@gotsaeng/mcp`) for MCP clients such as Claude Code
and Codex.

```text
Markdown Vault
-> Scanner
-> Parser
-> Classifier
-> Extractor
-> Stale Detector
-> Source Provenance Scorer
-> Confidence Scorer
-> Contradiction Candidate Detector
-> Context Compiler
-> Markdown/JSON Exporters
-> Local Manifest + Memory Diff
-> CLI, Obsidian adapter, and MCP stdio adapter
```

## Module Boundaries

`packages/core` owns parsing, classification, extraction, stale detection, compilation, and
export logic. It should remain framework-agnostic and free of CLI-specific behavior.

`packages/cli` owns command parsing, console output, exit codes, and user-facing errors.

`apps/obsidian-plugin` owns the desktop-only Obsidian adapter shell. It registers Obsidian
commands, stores adapter settings, resolves the current vault path, and delegates compilation to
`packages/core` instead of reimplementing parsing, extraction, stale detection, or export logic.

This extends to report rendering. The Report Hub's coverage, provenance, confidence,
contradiction, and warning-triage summaries are `packages/core` functions imported directly, not
adapter-local copies; where the in-app view differs it passes an option (`includeNoteTypes`,
`maxExamples`) rather than forking the renderer. The one deliberate exception is the hub's own
item list, which drops tags and uses a different omission footer. The LLM handoff document is
rendered the same way: `packages/core/src/exporters/handoff-exporter.ts` owns `renderLlmHandoff`
and the default section list. The plugin's `export-llm-handoff` command consumes it for the
standard six sections; `packages/mcp`'s `prepare_ai_handoff` tool consumes the same function with
an explicit, client-selected `sections` list — neither keeps its own copy.

`packages/mcp` owns the MCP stdio adapter: a `validate_vault` / `compile_context_pack` /
`list_context_artifacts` / `read_context_artifact` / `prepare_ai_handoff` tool surface over
`packages/core`, with vault/output roots fixed at process launch (`--vault`/`--output`) rather than
accepted per tool call. Like the CLI and the plugin, it delegates all compilation to
`packages/core` instead of reimplementing it.

## Data Flow

1. The scanner recursively finds local Markdown files.
2. The parser reads YAML frontmatter and Markdown body content.
3. The classifier assigns a note type from frontmatter, path, or filename.
4. The extractor reads explicit markers for facts, decisions, actions, risks, assumptions,
   questions, and insights.
5. The stale detector marks date-based stale items.
6. The provenance scorer assigns calibrated deterministic metadata-based source quality scores to
   extracted items.
7. The confidence scorer assigns deterministic extraction-confidence scores to extracted items.
8. The contradiction detector collects deterministic contradiction, conflict, and uncertainty cues.
9. The compiler assembles a typed `ContextPack`.
10. Exporters write human-readable Markdown and structured JSON.
11. The memory diff writer compares the previous local manifest against the current compile.
    `writeContextPack` also writes `ARTIFACT_INDEX.json`, a name/byte-size/sha256/description
    entry for every other generated file, so downstream tools can verify artifact integrity
    without re-reading full contents.
12. The CLI prints terminal summaries, while the Obsidian adapter writes local reports into the
    current vault.
13. The Obsidian adapter writes `REPORT_HUB.md` and exposes a Report Hub view for source-aware
    navigation without changing the core model-ready output.
14. Quality helpers infer objectives, group extracted items by source, triage warnings, and select
    high-signal review items.

## Constraints

The compiler does not call external AI services, upload data, collect credentials, sync files,
or use hidden network calls. Provenance, confidence, and contradiction candidate scoring are
metadata-based and do not semantically verify claims.
