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

`@gotsaeng/core` never touches the filesystem itself — every read/write goes through a
`FileSystemAdapter` you inject, so the same compiler runs unmodified against `node:fs`, an
in-memory store, or (as `apps/obsidian-plugin` does) `app.vault.adapter`. `@gotsaeng/core` does not
ship a `node:fs`-backed implementation; write a thin one, or use `@gotsaeng/cli`, which already has
one:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { compileContextPack, writeContextPack, type FileSystemAdapter } from "@gotsaeng/core";

// readText/readBinary return null only for a missing path — any other error
// (permissions, I/O) should still throw, or callers like
// readPreviousContextManifest will misread "the read genuinely failed" as
// "there's nothing here yet" and silently fall back to an empty baseline.
const isEnoent = (error: unknown) =>
  error instanceof Error && "code" in error && error.code === "ENOENT";

const fsAdapter: FileSystemAdapter = {
  exists: (p) =>
    fs.access(p).then(
      () => true,
      () => false,
    ),
  isDirectory: (p) =>
    fs.stat(p).then(
      (s) => s.isDirectory(),
      () => false,
    ),
  // This minimal example follows real directories and files only. The
  // production Node adapters (packages/cli, packages/mcp) also follow
  // symlinks, matching what the compiler's default fast-glob-based scanner
  // used to do — see packages/cli/src/node-file-system.ts if you need that.
  list: async (p) => {
    const entries = await fs.readdir(p, { withFileTypes: true });
    return {
      files: entries.filter((e) => e.isFile()).map((e) => path.join(p, e.name)),
      folders: entries.filter((e) => e.isDirectory()).map((e) => path.join(p, e.name)),
    };
  },
  readText: (p) =>
    fs.readFile(p, "utf8").catch((error: unknown) => {
      if (isEnoent(error)) return null;
      throw error;
    }),
  readBinary: (p) =>
    fs.readFile(p).catch((error: unknown) => {
      if (isEnoent(error)) return null;
      throw error;
    }),
  writeText: async (p, data) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, data, "utf8");
  },
  mkdir: (p) => fs.mkdir(p, { recursive: true }).then(() => undefined),
  remove: (p) => fs.rm(p, { force: true }),
  rmdir: (p) => fs.rmdir(p),
};

const pack = await compileContextPack(fsAdapter, {
  sourceRoot: "./notes",
  projectName: "My Project",
  staleDays: 90,
  ignoreGlobs: ["context-pack/**"],
});

await writeContextPack(fsAdapter, pack, "./context-pack");
```

`ignoreGlobs` is an optional list of `micromatch` patterns (relative to `sourceRoot`) excluded from
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

Each `ExtractedItem` also carries an optional `confidenceSource` field
(`"explicit_marker" | "task_list" | "section_line" | "heading_inference"`) recording how the item
was extracted. Exporters check this typed field — not a string match against a confidence label —
to implement the explicit-marker exemption above.

### Configuring the caps

Both bounds are overridable, independently, through `CompileOptions.caps`:

```ts
const caps = {
  perHeading: 25, // extractor.ts: inferred section_line items per heading (default 12)
  register: 500, // markdown-exporter.ts: shared cap for every dedicated register (default 200)
  insights: 300, // markdown-exporter.ts: Memory Snapshot Insights list (default 120)
};

const pack = await compileContextPack(fsAdapter, {
  sourceRoot: "./notes",
  projectName: "My Project",
  caps, // only `caps.perHeading` matters here — it shapes extraction
});

// register/insights only take effect at export time, so pass caps again:
await writeContextPack(fsAdapter, pack, "./context-pack", caps);
```

`perHeading` only affects `compileContextPack` (it changes what gets extracted in the first place).
`register` and `insights` only affect `writeContextPack`/`writeMarkdownContextPack`/
`renderMarkdownFiles` (they change what gets rendered from already-extracted items). All three are
optional and independently overridable; an omitted field falls back to its module default.

The CLI package `@gotsaeng/cli` is the recommended entry point for end users.
