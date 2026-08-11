# Historical Public Release Announcement — GotSaeng OS

> **This is the announcement draft used for the `0.10.0` release.** This is an immutable
> historical record, not a template to edit in place or current copy — the version numbers below
> are deliberately left as they were. The project has since shipped through `0.11.0`. The
> scope/positioning language is still substantively accurate; for a new announcement, copy this
> file's structure into a fresh draft with the current version and feature list.

GotSaeng OS v0.10 is now available as an open-source local-first context compiler for Markdown-based knowledge workflows.

It compiles scattered Markdown notes, chat exports, decisions, risks, questions, and execution records into auditable context packs for humans and AI tools.

## Install

```bash
npm install -g @gotsaeng/cli
gotsaeng doctor
```

## Compile a Markdown Vault

```bash
gotsaeng compile ./notes --output ./context-pack --project "My Project"
```

## What It Does

- Scans local Markdown files.
- Extracts facts, decisions, actions, risks, assumptions, questions, and insights.
- Detects stale context.
- Generates Markdown and JSON context-pack files.
- Writes deterministic memory diffs.
- Scores source provenance and extraction confidence using local metadata.
- Surfaces contradiction, conflict, and uncertainty candidates for human review.

## What It Does Not Do

GotSaeng OS v0.10 does not include telemetry, cloud sync, hidden network calls, credential collection, or LLM API calls.

The current release is a deterministic local compiler first. Optional AI integrations, if added later, should remain explicit, review-based, and user-controlled.

## Links

- GitHub: https://github.com/wonkwonlee/gotsaeng-os
- npm core: https://www.npmjs.com/package/@gotsaeng/core
- npm CLI: https://www.npmjs.com/package/@gotsaeng/cli
