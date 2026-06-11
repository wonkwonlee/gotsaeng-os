# GotSaeng OS — Examples

This directory contains a minimal Obsidian vault and its compiled output so you can see
exactly what GotSaeng OS produces without running anything first.

## Directory layout

```
examples/
├── sample-vault/       ← input: annotated Markdown notes
│   ├── 00_inbox/       ← raw captures (chat exports, meeting notes)
│   ├── 01_projects/    ← project context notes
│   ├── 02_decisions/   ← decision records
│   ├── 03_logs/        ← weekly reviews and logs
│   ├── 04_research/    ← research notes
│   └── templates/      ← vault templates (not extracted)
└── sample-output/      ← output: compiled context pack (13 files)
```

## Run it yourself

From the repo root:

```bash
npx -y @gotsaeng/cli compile examples/sample-vault --output ./out --project "My Project"
```

This produces the same 13 files as `sample-output/`.

## Output file map

| File | Purpose |
|---|---|
| `PROJECT_CONTEXT.md` | Distilled project state — active facts, key decisions, open actions |
| `MEMORY_SNAPSHOT.md` | Full snapshot of every extracted context item |
| `DECISION_LOG.md` | All decisions with rationale |
| `ACTION_BACKLOG.md` | Open and in-progress actions |
| `RISK_REGISTER.md` | Tracked risks and logged assumptions |
| `OPEN_QUESTIONS.md` | Unresolved questions |
| `STALE_CONTEXT.md` | Items flagged as potentially outdated |
| `SOURCE_PROVENANCE.md` | Per-item provenance scores (how well-sourced each item is) |
| `CONFIDENCE.md` | Per-item confidence scores |
| `CONTRADICTIONS.md` | Potential contradictions detected between notes |
| `MEMORY_DIFF.md` | Changes since last compile (empty on first run) |
| `CONTEXT_MANIFEST.json` | Machine-readable index of all context items |
| `COMPILE_REPORT.json` | Compile statistics and diagnostics |

## Annotation format

GotSaeng OS extracts typed items embedded in normal Markdown prose.
Open `sample-vault/01_projects/gotsaeng-os.md` for a full worked example.

```markdown
- fact: GotSaeng OS is a local-first context compiler.
- decision: Build the CLI before the Obsidian plugin.
- action: Implement the Markdown scanner and parser. status: done
- risk: A generic dashboard could dilute the compiler-first identity.
- assumption: Early users are likely Obsidian power users and technical builders.
- question: What is the smallest context pack that feels useful in a real handoff?
- insight: The real product is portable context infrastructure, not a note app.
```

Supported item types: `fact` · `decision` · `action` · `risk` · `assumption` · `question` · `insight`

Each item can carry optional metadata inline: `status:`, `priority:`, `updated:`.
