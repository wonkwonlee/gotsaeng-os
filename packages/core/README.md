# @gotsaeng/core

Core local-first context compiler for GotSaeng OS.

This package scans Markdown vaults, parses frontmatter and content, extracts deterministic context
items, detects stale context, scores local provenance and extraction confidence, surfaces
contradiction candidates, and writes Markdown/JSON context-pack artifacts.

It does not call LLM APIs, upload notes, add telemetry, or sync data.

## Install

```bash
npm install @gotsaeng/core
```

## Public API

```ts
import { compileContextPack, writeContextPack } from "@gotsaeng/core";

const pack = await compileContextPack({
  sourceRoot: "./notes",
  projectName: "My Project",
  staleDays: 90,
  ignoreGlobs: ["context-pack/**"],
});

await writeContextPack(pack, "./context-pack");
```

`ignoreGlobs` is an optional list of `fast-glob` patterns (relative to `sourceRoot`) excluded from
scanning in addition to the built-in defaults. Use it to keep a previously generated output folder
from being re-scanned on the next compile.

### Output bounds

Each dedicated single-category register (`RISK_REGISTER.md`, `ACTION_BACKLOG.md`, `OPEN_QUESTIONS.md`,
and the Memory Snapshot lists) caps each rendered list at 200 items by default. The output is
unchanged when a list is within that bound; once it is exceeded, high-signal items (explicit
`marker:` items first, then higher-confidence items) are kept and the remainder is summarized with an
`... N more items omitted` footer. Full counts always remain available in `COMPILE_REPORT.json`.
`ACTION_BACKLOG.md` applies the cap per status group (Open / Active / Unknown / Done), so it may
render up to that many items per group. Explicit-marker items are never dropped by this cap, even
when a single register contains more than 200 of them — the effective limit is raised to fit all
explicit-marker items, and only lower-signal items are trimmed.

The Memory Snapshot's Insights list uses a separate, higher default bound (120 items) since it tends
to run longer than the other registers on research-heavy vaults.

Section-level inferred extraction (a bullet under a `## Risks`/`## Questions`/etc. heading with no
explicit marker) is capped per heading at extraction time: `MAX_SECTION_LINE_ITEMS_PER_HEADING = 12`
in `extractor.ts`. Unlike the render-time register caps above, this bound drops data at the source —
capped bullets never become items, so they are absent from `COMPILE_REPORT.json` totals too. Explicit
markers are exempt from this cap regardless of how many appear under one heading.

Item text longer than 360 characters is truncated with a trailing `...`, and a warning recording the
source path and the original length is added to that item's `confidence.warnings` (surfaced in
`CONFIDENCE.md`).

### Configuring the caps

Both bounds are overridable, independently, through `CompileOptions.caps`:

```ts
const caps = {
  perHeading: 25, // extractor.ts: inferred section_line items per heading (default 12)
  register: 500, // markdown-exporter.ts: shared cap for every dedicated register (default 200)
  insights: 300, // markdown-exporter.ts: Memory Snapshot Insights list (default 120)
};

const pack = await compileContextPack({
  sourceRoot: "./notes",
  projectName: "My Project",
  caps, // only `caps.perHeading` matters here — it shapes extraction
});

// register/insights only take effect at export time, so pass caps again:
await writeContextPack(pack, "./context-pack", caps);
```

`perHeading` only affects `compileContextPack` (it changes what gets extracted in the first place).
`register` and `insights` only affect `writeContextPack`/`writeMarkdownContextPack`/
`renderMarkdownFiles` (they change what gets rendered from already-extracted items). All three are
optional and independently overridable; an omitted field falls back to its module default.

The CLI package `@gotsaeng/cli` is the recommended entry point for end users.
