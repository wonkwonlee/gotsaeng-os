# Context Schema

## Frontmatter

Supported frontmatter fields include:

- `type`
- `title`
- `status`
- `domain`
- `priority`
- `created`
- `updated`
- `tags`

Unknown fields are preserved in parsed note documents.

Real Obsidian vaults often use custom `type` values. `validate` defaults to compatibility mode and
maps common values such as `wiki`, `source`, `reflection`, `weekly`, `monthly`, and `conversation`
to the nearest compiler note type. Use `gotsaeng validate --strict` to treat unsupported
custom types as schema errors.

## Note Types

- `project`
- `decision`
- `daily`
- `weekly-review`
- `research`
- `chat-export`
- `template`
- `unknown`

## Extracted Item Kinds

- `fact`
- `decision`
- `action`
- `risk`
- `assumption`
- `question`
- `insight`

`todo` markers are normalized to `action`.

GotSaeng OS also supports deterministic inferred extraction from:

- plain Obsidian task lists such as `- [ ] Write release notes`
- section headings such as `Summary`, `Key Points`, `Open Questions / TODO`, and
  `Contradictions / Uncertainty`
- source metadata lines such as `Author / Origin: ...` and `URL / Location: ...`
- Korean label aliases such as `질문:`, `결정:`, `위험:`, `가정:`, `통찰:`, and `사실:`

## Status Values

- `open`
- `active`
- `done`
- `stale`
- `unknown`

## Priority Values

- `low`
- `medium`
- `high`

Priority can be inferred from `priority: high`, `priority: medium`, `priority: low`, or the
`!high`, `!medium`, and `!low` shorthand.

## Generated Files

- `PROJECT_CONTEXT.md`
- `MEMORY_SNAPSHOT.md`
- `DECISION_LOG.md`
- `ACTION_BACKLOG.md`
- `RISK_REGISTER.md`
- `OPEN_QUESTIONS.md`
- `STALE_CONTEXT.md`
- `SOURCE_PROVENANCE.md`
- `CONFIDENCE.md`
- `CONTRADICTIONS.md`
- `MEMORY_DIFF.md`
- `CONTEXT_MANIFEST.json`
- `COMPILE_REPORT.json`

## Deterministic IDs

Extracted item IDs are deterministic hashes of:

```text
sourcePath + kind + normalizedText
```

Random IDs are not used.

## Context Manifest

`CONTEXT_MANIFEST.json` is a deterministic local manifest of extracted context items. It records
item IDs, source paths, kind, text, status, priority, timestamps, tags, and whether the item is
currently stale. Current releases also record source provenance and confidence metadata. The
manifest is written into the output folder and used as the baseline for the next memory diff.

## Source Provenance

`SOURCE_PROVENANCE.md` summarizes deterministic metadata-based provenance scores. Each extracted
item can include:

- `score`: integer from 0 to 100
- `level`: `strong`, `moderate`, or `weak`
- `signals`: scoring factors, such as updated dates, known note types, explicit titles, tags,
  source status, item status, and item priority
- `warnings`: metadata gaps, such as missing updated dates, unknown source note types, or unknown
  item status
- `calibration`: optional provenance calibration version, currently `v0.10-local-metadata` for
  newly scored items

This is not semantic fact verification. It is a local quality-control heuristic for triage.

## Confidence Metadata

`CONFIDENCE.md` summarizes deterministic extraction-confidence scores. Each extracted item can
include:

- `score`: integer from 0 to 100
- `level`: `high`, `medium`, or `low`
- `signals`: scoring factors, such as explicit markers, task-list extraction, section patterns,
  note type, update metadata, item status, and item priority
- `warnings`: metadata gaps, such as missing updated dates, unknown source note types, or unknown
  item status

This is not semantic fact verification. It describes how reliable the local extraction path looks.

## Contradiction Candidates

`CONTRADICTIONS.md` summarizes deterministic review candidates for contradiction, conflict, and
uncertainty cues. Each candidate includes:

- `signal`: `explicit_marker`, `section_heading`, or `keyword_cue`
- `severity`: `review` for explicit markers and contradiction sections, or `watch` for keyword
  cues
- `text`: the local line or bullet that triggered the candidate
- `evidence`: local evidence such as source headings, signal type, and updated metadata

This is not semantic contradiction detection. It creates a local review queue that a human can
audit from source notes.

## Memory Diff

`MEMORY_DIFF.md` compares the previous `CONTEXT_MANIFEST.json` against the current compile. It
surfaces:

- newly added context
- changed context, such as status, priority, updated date, tags, or stale state changes
- newly stale context
- resolved context, such as done actions, no-longer-stale items, or removed/rewritten actionable
  items

Detail sections are grouped by source note so reviewers can inspect related changes together.

Text edits change deterministic item IDs, so rewritten items may appear as newly added plus
resolved.

## Compile Report Quality Fields

`COMPILE_REPORT.json` includes extraction and source coverage metadata:

- total extracted items
- item counts by kind
- item counts by status
- notes with and without extracted items
- note type coverage
- notes with and without `updated` dates
- warning triage, grouped into parse errors, missing updated dates, and other warnings
- provenance stats, including average score, strong/moderate/weak counts, and level counts
- confidence stats, including average score and level counts
- contradiction stats, including candidate count, signal counts, and review/watch counts

## Future Schema Directions

Future versions may add better contradiction grouping and source-pair calibration.
