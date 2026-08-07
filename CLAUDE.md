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
  `package.json` ×4, root + plugin `manifest.json`, root + plugin `versions.json`, `README.md`
  npx pins, and the `CHANGELOG.md` section). Run `pnpm check:versions` to verify the bump.
- Mirror the release content to the public repo's working tree, commit `Release X.Y.Z`, then push
  a **bare version tag** (e.g. `0.10.6`, no `v` prefix) to public `main`.
- The tag push triggers public `release.yml`: quality gates → npm OIDC publish of `@gotsaeng/core`
  then `@gotsaeng/cli` → GitHub Release with the Obsidian plugin assets.
- Do **not** tag this dev repo. The npm OIDC Trusted Publisher is bound to the public repo's
  workflow, so a tag here runs `release.yml` but the publish step fails with a 404/permission
  error.

## Architecture Principle

Core logic belongs in packages/core.
CLI logic belongs in packages/cli.
Obsidian adapter shell work belongs in apps/obsidian-plugin.
Do not reimplement core compiler behavior inside the Obsidian adapter.
