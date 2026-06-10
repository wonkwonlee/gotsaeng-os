# GotSaeng OS Obsidian Adapter

This is the v0.10 desktop-only Obsidian adapter for GotSaeng OS.

It is a thin shell around `@gotsaeng/core`. The plugin registers Obsidian commands, resolves the
current vault path, stores local settings, and writes generated reports into the vault. Compilation
logic stays in `packages/core`.

## Commands

- Compile Context Pack
- Generate Weekly Review
- Export LLM Handoff
- Validate Vault Schema
- Open Report Hub

The Report Hub view provides command buttons, shortcuts to generated reports, and latest compile
metrics. The generated `REPORT_HUB.md` includes Obsidian wikilinks back to source notes.
The weekly review report is high-signal by design: current objective, focus actions, grouped
actions, top questions, top risks, stale context, and warning triage.

By default, output is written to `.gotsaeng/context-pack`, which Obsidian may hide from the normal
file explorer. The Report Hub view can preview every generated Markdown and JSON artifact directly.
It also extracts source-note references from the selected preview and shows buttons that open the
original vault notes.
Use plugin settings to switch to the visible `Gotsaeng/Context Pack` folder when you want generated
files to appear as ordinary vault files. When switching between the hidden and visible managed output
folders, the next generated command removes stale GotSaeng-managed output files from the alternate
folder so the vault does not keep duplicate context packs. User-created files in those folders are
left untouched.

The core compiler writes `MEMORY_DIFF.md` and `CONTEXT_MANIFEST.json`. The plugin previews both
files from the Report Hub so previous/current compile changes can be inspected even when the output
folder is hidden.
The compiler also writes `SOURCE_PROVENANCE.md`, a deterministic metadata-based context quality
report. It does not call AI services or verify claims semantically.
The compiler also writes `CONFIDENCE.md`, a deterministic extraction-confidence report. The Report
Hub previews confidence output and shows confidence stats from the latest compile.
The compiler also writes `CONTRADICTIONS.md`, a deterministic candidate report for contradiction,
conflict, and uncertainty cues. It does not prove semantic inconsistency.
v0.10 also groups memory-diff sections by source note and shows calibrated provenance summaries
with strong, moderate, and weak buckets.

## Build

```bash
pnpm --filter @gotsaeng/obsidian-plugin build
```

The build writes:

```text
apps/obsidian-plugin/dist/
├── main.js
├── manifest.json
└── styles.css
```

Verify the local distribution artifacts before copying them into a vault:

```bash
pnpm smoke:obsidian
```

The smoke script checks the built files, validates the manifest version and `isDesktopOnly: true`, and
stages a temporary vault plugin install. The manifest is intentionally desktop-only because the adapter
needs a file-system vault path.

## Local Install

```bash
mkdir -p "/path/to/vault/.obsidian/plugins/gotsaeng-os"
cp apps/obsidian-plugin/dist/main.js \
  apps/obsidian-plugin/dist/manifest.json \
  apps/obsidian-plugin/dist/styles.css \
  "/path/to/vault/.obsidian/plugins/gotsaeng-os/"
```

Then restart Obsidian or disable/enable **GotSaeng OS** in Obsidian community plugin settings. Complete
`docs/obsidian-manual-smoke.md` before tagging a release that includes adapter changes.

## Privacy

v0.10 is local-only. It does not call external AI services, upload notes, collect credentials, add
telemetry, or sync data.
