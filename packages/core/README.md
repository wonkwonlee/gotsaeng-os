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
and the Memory Snapshot lists) caps each rendered list at 200 items. The output is unchanged when a
list is within that bound; once it is exceeded, high-signal items (explicit `marker:` items first,
then higher-confidence items) are kept and the remainder is summarized with an
`... N more items omitted` footer. Full counts always remain available in `COMPILE_REPORT.json`.
`ACTION_BACKLOG.md` applies the cap per status group (Open / Active / Unknown / Done), so it may
render up to that many items per group.

Item text longer than 360 characters is truncated with a trailing `...`, and a warning recording the
source path and the original length is added to that item's `confidence.warnings` (surfaced in
`CONFIDENCE.md`).

The CLI package `@gotsaeng/cli` is the recommended entry point for end users.
