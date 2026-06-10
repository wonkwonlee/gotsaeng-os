# Evaluation

## v0.10 Quality Criteria

- The CLI compiles `examples/sample-vault`.
- All generated files exist.
- Extracted item counts match expected sample behavior.
- Tests pass.
- Output ordering and IDs are deterministic.
- Personal vault compilation produces non-zero extracted items without requiring every note to use
  explicit markers.
- `COMPILE_REPORT.json` includes extraction and source coverage stats.
- The Obsidian adapter builds `main.js`, `manifest.json`, and `styles.css`.
- Obsidian adapter reports are generated locally and reuse `packages/core`.
- `REPORT_HUB.md` includes Obsidian wikilinks back to source notes.
- The Report Hub view typechecks and exposes local command shortcuts.
- The Report Hub view previews generated Markdown and JSON files even when the output folder is
  hidden.
- Obsidian settings can switch output between hidden, visible, and custom vault-local folders.
- `CONTEXT_MANIFEST.json` is generated and contains deterministic extracted item IDs.
- `MEMORY_DIFF.md` is generated and compares against the previous manifest when one exists.
- Memory diff includes newly added, changed, newly stale, and resolved context sections.
- Memory diff detail sections are grouped by source note.
- `SOURCE_PROVENANCE.md` is generated and contains provenance summary, weak items, strong items,
  and provenance warnings.
- `COMPILE_REPORT.json` includes `provenanceStats` with strong, moderate, and weak buckets.
- `CONTEXT_MANIFEST.json` includes provenance metadata for extracted items.
- `CONFIDENCE.md` is generated and contains confidence summary, high/low confidence items, and
  confidence warnings.
- `COMPILE_REPORT.json` includes `confidenceStats`.
- `CONTEXT_MANIFEST.json` includes confidence metadata for extracted items.
- `CONTRADICTIONS.md` is generated and contains review candidates, watchlist candidates, evidence,
  and local-only scope notes.
- `COMPILE_REPORT.json` includes `contradictionStats`.
- The Obsidian Report Hub preview extracts source-note links from Markdown and JSON artifacts.
- Source-note preview buttons open original vault notes while output remains hidden by default.
- `PROJECT_CONTEXT.md` includes objective inference metadata.
- `MEMORY_SNAPSHOT.md` and `COMPILE_REPORT.json` include warning triage.
- Weekly review output emphasizes high-signal actions, questions, risks, stale context, and
  warnings instead of dumping every extracted item.
- `.obsidian` and `.gotsaeng` folders are ignored by the scanner.
- No network calls are made by the compiler.
- No LLM APIs are called.
- `CONTEXT_MANIFEST.json` snapshot coverage protects deterministic item IDs and metadata after
  normalizing the local source root.

## Production-readiness Evaluation Gate

Before expanding into v0.11 engineering ops or team memory workflows, the release candidate should
pass the local production-readiness gate:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

Also run the local package smoke test documented in `docs/release.md` and the behavior audit in
`docs/security-audit.md`. Keep these checks local and deterministic; do not add external services,
telemetry, LLM API calls, or new dependencies just to evaluate the current release.

## Future Evaluation Ideas

- Output usefulness rating.
- Source coverage.
- Stale detection precision.
- Handoff quality.
- Context compression quality.
- Memory diff usefulness and noise control.
- Provenance scoring usefulness and noise control.
- Confidence scoring usefulness and noise control.
- Contradiction candidate usefulness and noise control.
