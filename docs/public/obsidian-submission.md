# Obsidian Community Plugin Submission — GotSaeng OS

This document is a local draft. All external actions (opening the PR, cutting the tag, uploading
the release assets) are performed manually by the maintainer after the version-agreement invariant
has been verified.

---

## Pre-submission checklist

- [ ] `apps/obsidian-plugin/manifest.json` `version` == `0.10.1`
- [ ] `apps/obsidian-plugin/versions.json` contains key `"0.10.1"`
- [ ] All five `package.json` files have `"version": "0.10.1"`
- [ ] Git tag `0.10.1` created locally (NO `v` prefix — Obsidian requires exact manifest match)
- [ ] GitHub release `0.10.1` created with assets: `main.js`, `manifest.json`, `styles.css`
- [ ] Release assets are from `apps/obsidian-plugin/dist/` after a clean `pnpm build`
- [ ] `pnpm typecheck && pnpm test && pnpm build && pnpm lint` pass on the tagged commit

---

## community-plugins.json entry

Add the following object to `community-plugins.json` in the
[obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) repo:

```json
{
  "id": "gotsaeng-os",
  "name": "GotSaeng OS",
  "author": "GotSaeng OS contributors",
  "description": "Compile your local Markdown vault into a structured context pack for LLM-assisted workflows. Local-first, no telemetry, no cloud, no LLM API calls.",
  "repo": "wonkwonlee/gotsaeng-os"
}
```

---

## Pull request title

```
Add GotSaeng OS plugin
```

## Pull request body

```markdown
## Plugin submission: GotSaeng OS

**Repository:** wonkwonlee/gotsaeng-os  
**Version:** 0.10.1  
**Manifest:** https://github.com/wonkwonlee/gotsaeng-os/releases/download/0.10.1/manifest.json

### What it does

GotSaeng OS compiles a local Obsidian vault into a structured context pack — a set of Markdown and
JSON files (`PROJECT_CONTEXT.md`, `MEMORY_SNAPSHOT.md`, `DECISION_LOG.md`, `ACTION_BACKLOG.md`,
`RISK_REGISTER.md`, `OPEN_QUESTIONS.md`, `SOURCE_PROVENANCE.md`, `CONFIDENCE.md`,
`CONTRADICTIONS.md`, `MEMORY_DIFF.md`, `CONTEXT_MANIFEST.json`, `COMPILE_REPORT.json`) — intended
for use in LLM context windows, agent memory, and project handoffs.

Provenance scoring, confidence scoring, and contradiction detection are deterministic heuristics
based on note metadata and keyword analysis. They are not semantic AI verification.

### isDesktopOnly justification

`isDesktopOnly: true` because:

1. **Node.js `fs` module** — the core compiler (`@gotsaeng/core`) reads vault files using Node's
   `fs` API via `fast-glob`, which is unavailable in the Obsidian mobile environment.
2. **Local vault path access** — the plugin compiles an on-disk vault directory; mobile Obsidian
   does not expose a writable local filesystem path in the same way.
3. **No mobile code path exists** — there is no fallback or mobile-safe implementation; shipping
   the plugin on mobile would result in immediate failure at compile time.

### Checklist

- [x] I have read the plugin developer guidelines
- [x] `id` in `manifest.json` matches the folder name and `community-plugins.json` entry
- [x] `minAppVersion` is set to `1.5.0`
- [x] `isDesktopOnly` is set to `true` with justification above
- [x] No external network calls, no telemetry, no LLM API calls
- [x] Release `0.10.1` exists with `main.js`, `manifest.json`, and `styles.css` assets
- [x] Tag is exactly `0.10.1` (no `v` prefix)
```

---

## Release asset upload order

When creating the GitHub release:

1. Create the release from tag `0.10.1` (no `v` prefix).
2. Upload from `apps/obsidian-plugin/dist/`:
   - `main.js`
   - `manifest.json`
   - `styles.css`
3. Verify the release URL resolves:
   `https://github.com/wonkwonlee/gotsaeng-os/releases/download/0.10.1/manifest.json`

---

## Post-submission

The Obsidian bot will run automated checks. Human review follows — shepherd the PR through change
requests until merged. Bot-green is NOT the done state; merge is.
