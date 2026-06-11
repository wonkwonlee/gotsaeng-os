# Release Runbook

## Overview

Releases are tag-triggered via `.github/workflows/release.yml`.
Tag names use **bare version format — NO `v` prefix** (e.g. `0.10.1`, not `v0.10.1`).
This satisfies Obsidian's tag-equals-manifest-version rule.

---

## OIDC Trusted Publisher Pre-requisite (manual — do once per package)

Before the first tag, configure **npm Trusted Publisher (OIDC)** for **both** packages in the npm web UI:

1. Log in to [npmjs.com](https://www.npmjs.com) as the package maintainer.
2. Navigate to `@gotsaeng/core` → Settings → Publish → **Trusted Publishers** → Add.
   - **Owner:** `wonkwonlee`
   - **Repository:** `gotsaeng-os`
   - **Workflow file:** `release.yml`
   - **Environment:** *(leave blank)*
3. Repeat step 2 for `@gotsaeng/cli`.

> **Why both packages?** The workflow publishes core _and_ cli in the same job using OIDC.
> If either package lacks a trusted publisher entry, its publish step will silently fail.

---

## Version-Agreement Invariant

All four of the following must agree before cutting a tag:

| Source | Where |
|---|---|
| Root `package.json` → `version` | `package.json` |
| `packages/core/package.json` → `version` | `packages/core/package.json` |
| `packages/cli/package.json` → `version` | `packages/cli/package.json` |
| `apps/obsidian-plugin/manifest.json` → `version` | `apps/obsidian-plugin/manifest.json` |
| Key in `apps/obsidian-plugin/versions.json` | `apps/obsidian-plugin/versions.json` |
| Git tag name | `git tag -l <version>` |

Verify before tagging:

```bash
node -p "require('./package.json').version"
node -p "require('./packages/core/package.json').version"
node -p "require('./packages/cli/package.json').version"
node -p "require('./apps/obsidian-plugin/manifest.json').version"
node -p "Object.keys(require('./apps/obsidian-plugin/versions.json'))"
```

All five must print the same version string (e.g. `0.10.1`).

---

## Dev → Public Repository Sync

Development happens in `gotsaeng-os-dev` (full history). The public repository
`wonkwonlee/gotsaeng-os` carries snapshot commits only — one squash commit per release.
Tags, GitHub releases, the release workflow, and the Obsidian submission all operate on
the **public** repository, so every release must be synced there first.

From a sibling checkout layout (`~/projects/gotsaeng-os-dev` and `~/projects/gotsaeng-os`):

```bash
cd ~/projects/gotsaeng-os
git rm -r -q .                                         # clear tracked files (.git is kept)
git -C ../gotsaeng-os-dev archive HEAD | tar -x -C .   # extract dev's tracked files only
rm -rf obsidian-vault-update                           # dev-only personal notes — never public
git add -A
git commit -m "Release <version>"
git push
```

Why this shape:

- `git archive HEAD` exports **tracked files only** — untracked/ignored dev artifacts
  (`.vault-copy/`, `.omc/`, `node_modules/`, `dist/`, `coverage/`) are excluded automatically.
- Clearing tracked files first means files deleted in dev do not linger in public.
- `obsidian-vault-update/` is tracked in dev but is personal vault material — always remove
  it before committing.
- Run the **Pre-Publish Safety Scan** (below) in the public repo before pushing.

---

## Release Checklist

1. **Bump versions** — update all five locations above to the new version.
2. **Commit** the version bump on `main` in `gotsaeng-os-dev`.
3. **Run quality gates locally:**
   ```bash
   pnpm typecheck && pnpm test && pnpm build && pnpm lint
   ```
4. **Sync to the public repository** (see "Dev → Public Repository Sync" above) and push.
5. **Tag on the public repository** (bare version, no `v` prefix):
   ```bash
   git tag 0.10.1
   git push origin 0.10.1
   ```
6. The tag push triggers `.github/workflows/release.yml` on the public repository:
   - Quality job runs first (`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint`).
   - Publish job runs only after quality passes.
   - **`@gotsaeng/core` is published first**, then `@gotsaeng/cli`.

---

## Publish Order: Core Before CLI

`@gotsaeng/cli` declares `@gotsaeng/core` as a dependency.
Publishing cli before core creates a window where npm resolves cli against a stale core version.
The workflow enforces: **core → cli**, with no manual intervention required.

---

## Half-Published State (Rollback)

npm versions are **immutable** — a published version cannot be overwritten or unpublished after 72 hours.

If `@gotsaeng/core` publishes successfully but `@gotsaeng/cli` fails:

1. **Do not attempt to re-publish under the same version.**
2. **Fix the root cause** in the source.
3. **Bump both packages to the next patch version in lockstep** (e.g. `0.10.1` → `0.10.2`).
   Even though core `0.10.1` is already live and correct, both packages must move together
   to maintain a consistent publish set.
4. **Update all five version-agreement sources** (see invariant table above).
5. Commit, tag the new version, push — the workflow re-runs cleanly.

> The same lockstep rule applies if cli publishes but core fails (unlikely given the enforced order,
> but possible if core's publish step succeeds then the registry rejects it post-upload).

---

## Coverage (Maintainer Signal)

Run coverage locally to check test health — it is not published as a public badge:

```bash
pnpm test:coverage
```

This uses `@vitest/coverage-v8`. Reports are written to `coverage/` (gitignored).
No coverage threshold is enforced in CI; it is a maintainer tool only.

---

## v0.10 Package Readiness

GotSaeng OS v0.10 is structured for package publishing:

- `@gotsaeng/core` — framework compiler API (public).
- `@gotsaeng/cli` — `gotsaeng` command (public).
- `@gotsaeng/shared` — shared constants (`"private": true`, not published).
- `apps/obsidian-plugin` — private desktop-only Obsidian adapter.

The root package is intentionally private (monorepo container).

---

## Pre-Publish Safety Scan

Before committing a release-candidate, run the public-safety scan:

```bash
git grep -n -E '(/Users/|personal vault|v0\.9 includes|OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|github_pat_|ghp_|npm_|BEGIN (RSA|OPENSSH|PRIVATE)|api[_-]?key|password|secret|token)' HEAD -- . ':!docs/release.md' ':!docs/security-audit.md'
```

Expected result: no matches.

---

## Automated Smoke Checks

Use the root smoke scripts to rehearse release readiness without publishing:

```bash
pnpm smoke:clean-clone   # Clone → install → quality gate
pnpm smoke:package       # Pack tarballs → install → gotsaeng compile smoke
pnpm smoke:obsidian      # Build plugin → verify assets + manifest version
pnpm smoke:release       # All three in sequence
```

---

## Candidate Publish Commands (manual fallback)

Run these only after quality gates pass and OIDC trusted publishers are configured:

```bash
pnpm --filter @gotsaeng/core publish --access public --provenance
pnpm --filter @gotsaeng/cli publish --access public --provenance
```

`@gotsaeng/shared` has `"private": true` and must never be published.
