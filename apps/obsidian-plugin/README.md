# GotSaeng OS Obsidian Adapter

This is the desktop-only Obsidian adapter for GotSaeng OS.

It is a thin shell around `@gotsaeng/core`. The plugin registers Obsidian commands, resolves the
current vault path, stores local settings, and writes generated reports into the vault. Compilation
logic stays in `packages/core`.

## Commands

- Compile Context Pack
- Generate Weekly Review
- Export LLM Handoff
- Validate Vault Schema
- Open Report Hub
- Switch Output Folder to Hidden
- Switch Output Folder to Visible

The Report Hub view provides command buttons, shortcuts to generated reports, and latest compile
metrics. The generated `REPORT_HUB.md` includes Obsidian wikilinks back to source notes.
The weekly review report is high-signal by design: current objective, focus actions, grouped
actions, top questions, top risks, stale context, and warning triage.

By default, output is written to `.gotsaeng/context-pack`, which Obsidian may hide from the normal
file explorer. The Report Hub view can preview every generated Markdown and JSON artifact directly.
It also extracts source-note references from the selected preview and shows buttons that open the
original vault notes. Below the preview, a Backlinks section aggregates source-note references
across every generated report (not just the one being previewed), ranked by total reference count,
so you can see at a glance which reports cite a given note.
Use plugin settings, or the `Switch Output Folder to Hidden` / `Switch Output Folder to Visible`
command-palette commands, to move generated files between the hidden and visible managed output
folders without opening the settings tab. Either way, switching removes stale GotSaeng-managed
output files from the alternate folder — immediately for the command-palette commands, on the next
generated command for the settings-tab dropdown — so the vault does not keep duplicate context
packs. User-created files in those folders are left untouched.

The core compiler writes `MEMORY_DIFF.md` and `CONTEXT_MANIFEST.json`. The plugin previews both
files from the Report Hub so previous/current compile changes can be inspected even when the output
folder is hidden.
The compiler also writes `SOURCE_PROVENANCE.md`, a deterministic metadata-based context quality
report. It does not call AI services or verify claims semantically.
The compiler also writes `CONFIDENCE.md`, a deterministic extraction-confidence report. The Report
Hub previews confidence output and shows confidence stats from the latest compile.
The compiler also writes `CONTRADICTIONS.md`, a deterministic candidate report for contradiction,
conflict, and uncertainty cues. It does not prove semantic inconsistency.
The compiler also writes `ENGINEERING_OPS.md`, a release-gate snapshot combining the quality,
warning, provenance, confidence, and contradiction summaries in one place, and `TEAM_MEMORY.md`, a
team-facing handoff with the current objective, active work, decisions, risks, open questions, and
review queues. Both are generated from the same local compiler signals as the other reports, and
the Report Hub previews both like every other generated artifact.
The adapter also groups memory-diff sections by source note and shows calibrated provenance
summaries with strong, moderate, and weak buckets.
The Context Pack Files grid groups artifacts into Core Reports, Governance (Decision Log, Risk
Register, Open Questions, Stale Context), Analysis, and Raw Data so no single group holds more than
about 7 items, and a filter field above the grid narrows the visible buttons by name as you type.
The filter reports its own result count directly beneath the field ("Showing 3 of 20 files.") and
names the query when nothing matches it, rather than leaving a blank space where the grid was.
Screen readers get the same sentence announced from a live region.

Before the first compile the Report Hub shows one thing rather than five empty sections: a "No
context pack yet" note above the four command buttons, plus where the output will be written.
The stats, the artifact grid, the preview and the backlink list appear once a compile report
exists — there is nothing for them to show until then, and no output folder is swept to find that
out. An unreadable compile report is a different case and still renders the full pane, since
generated files may well exist alongside it.

The "Latest Compile" block is dated: it says how long ago the compile ran and at what time
("Compiled 5 minutes ago (2:14 PM)"), read from the same `ARTIFACT_INDEX.json` the compile writes,
so the numbers underneath it are never mistaken for current. Its eleven numbers are ordered by what
they answer: warnings, parse errors, and contradictions lead as the "is anything wrong right now"
row, and the eight that describe the shape of the vault (files, items, coverage, provenance and
confidence scores) follow in a quieter one. Nothing is hidden — only re-weighted. The two score
metrics whose names do not say what a good value looks like — average provenance and average
confidence — carry an inline note that they are 0–100 scores where higher is better.

Source-note and backlink buttons carry the full note path in their accessible name as well as in
the hover tooltip, so the path is reachable without a mouse.
The Report Hub sizes itself against its own pane rather than the Obsidian window: the command,
stats, artifact, and source-note grids re-flow as the leaf is resized (down to a single column in a
sidebar-width pane), and the preview box is capped at a share of the pane's height. A very large
artifact — an LLM handoff export from a big vault, say — is previewed up to the first 2000 lines
(or 200 KB), with a line count and an "Open <file>" button above the preview for reading the rest
in a normal editor pane.
A command button in flight relabels itself (e.g. "Compile…") and sets `aria-busy` in addition to
being disabled, so a slow compile on a large vault reads as running rather than unresponsive. Every
command writes into the same output folder, so only one runs at a time: while one is in flight all
four command buttons are disabled (only the running one is relabelled), and commands started from
the command palette or the ribbon icon queue behind it rather than interleaving their writes. Start
and finish are also announced through a polite live region for screen-reader users — the start
announcement is written the moment the command begins, not batched into the render that already
carries "finished". Keyboard focus returns to the button you started the command from once it
settles, even though disabling the button drops focus in the meantime. A command failure's banner
shows the action name and a timestamp alongside the error message, is announced through an assertive
live region, and can be dismissed on its own without needing to run another command first. If `COMPILE_REPORT.json` exists but cannot be read, the Report Hub says so ("Compile
report could not be read — re-run Compile to regenerate it.") instead of freezing on stale content.

The settings tab groups its rows under two headings — "Output location" (folder visibility and
path) and "Compile behavior" (stale days, strict validation, open-generated-file) — with the
project name above them, on both rendering paths.

Settings validation is shown on the settings tab itself: an invalid stale-days or custom output
folder value is reported inline underneath the field it belongs to (and announced), in addition to
the aggregate "Settings need attention" summary at the top of the tab. That summary also reports a
persisted value that had to be reset when settings were loaded (an invalid saved output folder or
stale-days value is always coerced back to a safe default, since the output folder is resolved
against the vault and swept for cleanup — the summary is how that reset stops being silent). This is
identical on both of Obsidian's settings rendering paths — the declarative API used from 1.13.0
onward and the imperative fallback used by older hosts. Typed settings take effect as you type but
are written to `data.json` once typing settles (and immediately when the field is left, the tab is
closed, or the plugin is unloaded) rather than once per keystroke.

The custom output folder field commits when you press Enter or leave the field, and its description
says so — along with the fact that applying a new path deletes GotSaeng-generated files from the
folder being left (which is also confirmed in a dialog before anything is removed). Outside
`Custom path` visibility the field is read-only rather than disabled, so the output folder actually
in use can still be focused, selected, and copied.

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

## Verifying a Downloaded Release Build

Each tagged release publishes `main.js`, `manifest.json`, and `styles.css` as GitHub Release
assets, built and uploaded by this repo's `release.yml` workflow with
[build provenance attestation](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds).
If you downloaded these files from a GitHub Release instead of building them locally, verify they
were produced by that workflow from this repo's source before installing them into a vault:

```bash
gh attestation verify main.js --repo wonkwonlee/gotsaeng-os
gh attestation verify manifest.json --repo wonkwonlee/gotsaeng-os
gh attestation verify styles.css --repo wonkwonlee/gotsaeng-os
```

Each command should report a successful verification against the `wonkwonlee/gotsaeng-os` build
workflow. Requires the [GitHub CLI](https://cli.github.com/) (`gh`) version 2.49 or newer.

## Privacy

GotSaeng OS is local-only. It does not call external AI services, upload notes, collect
credentials, add telemetry, or sync data.
