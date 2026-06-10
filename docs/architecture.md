# Architecture

GotSaeng OS v0.10 is a CLI-first context compiler with a desktop-only Obsidian adapter and report
hub.

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
-> CLI and Obsidian adapter
```

## Module Boundaries

`packages/core` owns parsing, classification, extraction, stale detection, compilation, and
export logic. It should remain framework-agnostic and free of CLI-specific behavior.

`packages/cli` owns command parsing, console output, exit codes, and user-facing errors.

`apps/obsidian-plugin` owns the desktop-only Obsidian adapter shell. It registers Obsidian
commands, stores adapter settings, resolves the current vault path, and delegates compilation to
`packages/core` instead of reimplementing parsing, extraction, stale detection, or export logic.

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
12. The CLI prints terminal summaries, while the Obsidian adapter writes local reports into the
   current vault.
13. The Obsidian adapter writes `REPORT_HUB.md` and exposes a Report Hub view for source-aware
   navigation without changing the core model-ready output.
14. Quality helpers infer objectives, group extracted items by source, triage warnings, and select
    high-signal review items.

## v0.10 Constraints

The compiler does not call external AI services, upload data, collect credentials, sync files,
or use hidden network calls. Provenance, confidence, and contradiction candidate scoring are
metadata-based and do not semantically verify claims.
