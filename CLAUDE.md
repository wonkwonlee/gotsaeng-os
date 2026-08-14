# CLAUDE.md

## Project

GotSaeng OS is a local-first context compiler for Markdown-based knowledge workflows.

## Working Agreements

- Use pnpm.
- Use strict TypeScript.
- Prefer small pure functions.
- Keep current releases local-only.
- Do not add telemetry.
- Do not add LLM API calls unless explicitly requested in a future task.
- Do not add cloud sync.
- Do not introduce new dependencies without a clear reason.
- Run tests after behavior changes.
- Update docs when changing public behavior.

## Quality Gates

Before completing a task, run:

- pnpm typecheck
- pnpm test
- pnpm build
- pnpm lint
- pnpm format:check
- pnpm check:versions

If a command cannot run, explain why.

`format:check` and `check:versions` are CI gates. `check:versions` enforces the release
version-agreement invariant described in `docs/release.md`.

Never restore files with `git checkout -- .` or `git restore .` to undo a temporary
experiment: it also discards uncommitted work elsewhere in the tree. Commit first, or
copy the file aside and restore it explicitly.

## Release Process

Releases are **always cut on the public deploy mirror** (`wonkwonlee/gotsaeng-os`), never on
this dev repo. The two repos have unrelated histories: dev is the canonical trunk, public is the
deploy mirror.

- Develop and land changes here on dev `main` (including the `Release X.Y.Z` version-bump commit:
  `package.json` ×5, root + plugin `manifest.json`, root + plugin `versions.json`, `README.md`
  npx pins, and the `CHANGELOG.md` section). Run `pnpm check:versions` to verify the bump.
- Mirror the release content to the public repo's working tree, commit `Release X.Y.Z`, then push
  a **bare version tag** (e.g. `0.10.6`, no `v` prefix) to public `main`.
- The tag push triggers public `release.yml`: quality gates → npm OIDC publish of `@gotsaeng/core`
  then `@gotsaeng/cli` then `@gotsaeng/mcp` → GitHub Release with the Obsidian plugin assets.
- Do **not** tag this dev repo. The npm OIDC Trusted Publisher is bound to the public repo's
  workflow, so a tag here runs `release.yml` but the publish step fails with a 404/permission
  error.

### Which repo am I in? (check before any commit/push)

`gotsaeng-os-dev` (this repo) is **private**; `wonkwonlee/gotsaeng-os` (public) is **public**.
That's the actual reason two repos exist — not just "clean release history": all in-progress
work, planning docs (`docs/superpowers/plans/`), and internal notes must stay in the private repo
and never leak into public's history. Before committing or pushing anywhere, confirm which repo
you're in:

```bash
git remote get-url origin
```

- Ends in `gotsaeng-os-dev` → private dev trunk. Normal PR workflow, or direct commits to `main`
  for the documented `Release X.Y.Z` version-bump step specifically.
- Is exactly `gotsaeng-os` (no `-dev` suffix) → **public mirror**. Treat as a release-sync target
  only. Do not make ad hoc source/doc edits there outside the documented sync flow below — public
  `main` also carries a GitHub ruleset ("Protect main": PR required, 2 required status checks —
  `Quality (Node 20)`, `Quality (Node 22)`), so a direct `git push` is rejected outright
  (`GH013: Repository rule violations`); sync via a PR (squash-merge, matching the existing
  one-commit-per-release history) instead.

**Known failure mode, already happened once:** on 2026-08-10, two commits (a `.gitignore` fix and
a docs accuracy pass) were made directly on public and never backported to dev. They sat
undetected until an explicit audit on 2026-08-11 caught them — right before the next
dev→public sync (`git rm -r . && git archive dev-HEAD | tar -x`) would have silently reverted
both, since that sync wholesale-overwrites public from dev with no exceptions. If an emergency
hotfix ever must land directly on public, **backport it into dev in the same sitting** — it does
not "sync itself," and dev is not automatically checked against public for drift.

## Architecture Principle

Core logic belongs in packages/core.
CLI logic belongs in packages/cli.
Obsidian adapter shell work belongs in apps/obsidian-plugin.
Do not reimplement core compiler behavior inside the Obsidian adapter.
This includes report rendering: the Obsidian Report Hub imports core's summary renderers and
passes options where it needs a trimmed variant, rather than keeping its own copies.
