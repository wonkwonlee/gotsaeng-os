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

The CLI package `@gotsaeng/cli` is the recommended entry point for end users.
