# Release Runbook

## Overview

Releases are tag-triggered via `.github/workflows/release.yml`.
Tag names use **bare version format — NO `v` prefix** (e.g. `0.10.2`, not `v0.10.2`).
This satisfies Obsidian's tag-equals-manifest-version rule.

---

## OIDC Trusted Publisher Pre-requisite (manual — do once per package)

Before the first tag, configure **npm Trusted Publisher (OIDC)** for **all three** packages in the npm web UI:

1. Log in to [npmjs.com](https://www.npmjs.com) as the package maintainer.
2. Navigate to `@gotsaeng/core` → Settings → Publish → **Trusted Publishers** → Add.
   - **Owner:** `wonkwonlee`
   - **Repository:** `gotsaeng-os`
   - **Workflow file:** `release.yml`
   - **Environment:** `release`
3. Repeat step 2 for `@gotsaeng/cli`.
4. Repeat step 2 for `@gotsaeng/mcp` — **but see the bootstrap requirement below first.**

> **Why all three packages?** The workflow publishes core, cli, _and_ mcp in the same job using
> OIDC. If any package lacks a trusted publisher entry, its publish step will silently fail.

### Optional: require manual approval before publish

`release.yml`'s `publish` job runs under a GitHub Environment named `release` (matching the
Environment set above). `quality` already refuses to run this pipeline at all for a tag that
doesn't point at a commit on `main` (see its "Verify tag targets a commit on main" step) — that
check is always on and needs no setup. For an additional, optional layer, configure the `release`
environment (repo **Settings → Environments → New environment**, name it `release`) with a
**required reviewers** protection rule. With that set, `publish` pauses for manual approval before
it runs at all — before the OIDC token exchange, before any package script executes — so even a
tag pointing at reviewed `main` history still needs a human to approve the actual publish.

If you set this up, keep the approval turnaround under the `quality` job's `obsidian-plugin-dist`
artifact retention window (14 days as of this writing). `github-release` downloads that artifact
after `publish` succeeds; if it expired while `publish` was waiting on your approval, the npm
packages are already published (npm versions are immutable) but the GitHub Release step has
nothing to attach and can't be cleanly rerun. Approve promptly, or raise `retention-days` on that
upload step if your review cadence runs longer.

### `@gotsaeng/mcp` bootstrap publish — completed, kept as a historical record

**This procedure is done; see the Status note at the end of this section.** `@gotsaeng/mcp` is now
published for real (`0.12.0`, `latest`), and its Trusted Publisher is registered. The steps below
are preserved unmodified as a reference for bootstrapping any _future_ new publishable package —
do not re-run them for `@gotsaeng/mcp`.

At the time this was written, `@gotsaeng/core` and `@gotsaeng/cli` already existed on npm, so their
Trusted Publisher could be configured from each package's existing Settings page. `@gotsaeng/mcp`
had **never been published** — an unpublished package name has no Settings page on npmjs.com, so
its Trusted Publisher could not be configured yet, and the tag-triggered `release.yml` publish step
(OIDC-only, no `NODE_AUTH_TOKEN`) could not authenticate a first-ever publish either. Without this
step, the first tag would have published core and cli, then failed on the mcp step, skipped the
GitHub Release job, and left the tag half-published.

npm versions are immutable, so the bootstrap publish had to use a version **distinct from** (lower
than) the first real `@gotsaeng/mcp` version the eventual release tag would publish — otherwise the
tag's CI publish step would try to republish that same version number, npm would reject it, and the
mcp step would fail after core and cli had already gone out. It also had to skip `--provenance`:
npm only generates provenance automatically on a supported CI/CD system (GitHub Actions, etc.) and
throws `EUSAGE` for a plain local `npm publish`, since there's no CI identity to attest to yet.

The one-time bootstrap procedure (for reference — do not repeat for `@gotsaeng/mcp`):

1. From a local, clean checkout, temporarily set `packages/mcp/package.json`'s `version` to a
   throwaway pre-release below any version this project will ever tag for real, e.g. `0.0.1`.
   **Do not commit this edit** — it exists only for the one-off manual publish command below and
   must never enter the version-agreement invariant (root `package.json` and the other workspace
   packages stay wherever they already are).
2. Authenticate as the package maintainer. **If the account's 2FA is WebAuthn/passkey-only (no
   TOTP app), `npm login` and classic Automation tokens are NOT enough** — both still hit
   `EUSAGE`/`EOTP` on publish (`npm publish --otp=<code>` only accepts a TOTP code; WebAuthn has
   no CLI path, and fully disabling account 2FA makes it worse — npm then rejects the publish
   outright with `E403: Two-factor authentication or granular access token with bypass 2fa
enabled is required to publish packages`). The one path that actually works: keep 2FA enabled,
   then create an npm **Granular Access Token** with **"Bypass two-factor authentication"**
   explicitly checked (npmjs.com → Access Tokens → Generate New Token → Granular Access Token →
   scope it to `@gotsaeng/mcp`, read+write, short expiration), then
   `npm config set //registry.npmjs.org/:_authToken=<token>` locally. Revoke the token immediately
   after the bootstrap publish below — it's single-use.
3. Publish once manually, without `--provenance`: this deliberately-uncommitted version edit
   leaves the working tree dirty, and pnpm refuses to publish from a dirty tree
   (`ERR_PNPM_GIT_UNCLEAN`) unless told not to check — pass `--no-git-checks`. Also pass
   `--tag bootstrap`: npm's default dist-tag is `latest`, and if any time passes between this
   bootstrap and the first real v0.13 release, an unpinned `npx @gotsaeng/mcp` would otherwise
   resolve to this throwaway `0.0.1` build in the meantime.
   `pnpm --filter @gotsaeng/mcp publish --access public --no-git-checks --tag bootstrap`.
4. Discard the temporary version edit (`git checkout -- packages/mcp/package.json`).
5. Only now does `@gotsaeng/mcp` have a Settings page — go back to step 4 above and register its
   Trusted Publisher.
6. Bump `packages/mcp/package.json` to the real target release version alongside the other four
   version-agreement files when cutting the actual release (see the invariant table below) and run
   `pnpm check:versions`. That version is higher than the `0.0.1` bootstrap publish, so the
   OIDC-authenticated `release.yml` step publishes it normally through CI, same as core and cli.

> **Status:** all steps done. `@gotsaeng/mcp@0.0.1` was bootstrap-published on 2026-08-11 via a
> Granular Access Token with 2FA bypass. As expected, `--tag bootstrap` did **not** stop npm from
> also assigning `latest` to it — npm always assigns `latest` to a package's first-ever published
> version regardless of `--tag`, and (confirmed by trying) `npm dist-tag rm <pkg> latest` returns
> `403`/`401` when it's the package's only version, since there's no other version to fall back
> to. Trusted Publisher registration (step 5) was completed, and the real Release 0.12.0 CI
> publish (step 6) published `@gotsaeng/mcp@0.12.0` on 2026-08-11, which naturally reclaimed
> `latest` from the `0.0.1` placeholder. `npx @gotsaeng/mcp` now resolves to the real server.

---

## npm Version Pin (lesson learned, 0.11.0 release)

`.github/workflows/release.yml`'s publish job upgrades npm before publishing
(`npm install -g npm@11`). Do not change this to `npm@latest` or pin to the 10.x line — both were
tried during the 0.11.0 release and both broke the release:

- npm 10.x (Node 20's bundled version) does not support OIDC trusted publishing at all (that
  shipped in npm 11.5.1). It silently falls back to an unauthenticated publish request, which npm
  rejects with a 404 rather than an auth error.
- `npm@latest` (currently the 12.x line) requires Node `>=22.22.2 || >=24.15.0 || >=26.0.0`, which
  breaks the `Upgrade npm` step outright on this job's Node 20 runner.
- npm 11.x supports OIDC trusted publishing and only requires Node `^20.17.0 || >=22.9.0`, which
  this job's Node 20 satisfies. Keep the pin at the 11.x line (`npm@11`, not a specific patch, so
  it still picks up new 11.x patches).

---

## Version-Agreement Invariant

All of the following must agree before cutting a tag:

| Source                                           | Where                                |
| ------------------------------------------------ | ------------------------------------ |
| Root `package.json` → `version`                  | `package.json`                       |
| `packages/core/package.json` → `version`         | `packages/core/package.json`         |
| `packages/cli/package.json` → `version`          | `packages/cli/package.json`          |
| `packages/mcp/package.json` → `version`          | `packages/mcp/package.json`          |
| `apps/obsidian-plugin/package.json` → `version`  | `apps/obsidian-plugin/package.json`  |
| `apps/obsidian-plugin/manifest.json` → `version` | `apps/obsidian-plugin/manifest.json` |
| Key in `apps/obsidian-plugin/versions.json`      | `apps/obsidian-plugin/versions.json` |
| Root `manifest.json` / `versions.json` (copies)  | `manifest.json`, `versions.json`     |
| `npx` pins in the README                         | `README.md`                          |
| Git tag name                                     | `git tag -l <version>`               |

> **Why root copies?** The Obsidian community directory portal reads `manifest.json` from the
> HEAD of the repository's **root**. The root `manifest.json` and `versions.json` must be exact
> copies of the ones in `apps/obsidian-plugin/`. Refresh them on every version bump:
>
> ```bash
> cp apps/obsidian-plugin/manifest.json manifest.json
> cp apps/obsidian-plugin/versions.json versions.json
> ```

Verify before tagging:

```bash
pnpm check:versions
```

`scripts/check-versions.mjs` checks every row of the table above except the git tag: it
discovers workspace packages rather than listing them (so adding or removing a package cannot
drop it from the check), confirms the root `manifest.json`/`versions.json` are **byte-identical**
to the plugin originals, confirms `versions.json` maps the release version to the manifest's
`minAppVersion`, and confirms the README `npx` pins match. It exits non-zero and names every
mismatched file.

This check also runs in CI and in `pnpm smoke:clean-clone`, so a partially-applied version bump
now fails before the tag is cut rather than at Obsidian directory submission.

---

## Dev → Public Repository Sync

Development happens in `gotsaeng-os-dev` (full history). The public repository
`wonkwonlee/gotsaeng-os` carries snapshot commits only — one squash commit per release.
Tags, GitHub releases, the release workflow, and the Obsidian submission all operate on
the **public** repository, so every release must be synced there first.

On this machine, dev and public are permanent sibling checkouts under one parent folder —
`~/dev/GotSaeng-OS/gotsaeng-os-dev` (dev, canonical trunk) and `~/dev/GotSaeng-OS/gotsaeng-os`
(public, deploy mirror). Both live under `~/dev/GotSaeng-OS/` and always will; a fresh machine
setup should recreate this same sibling layout rather than an arbitrary one.

```bash
cd ~/dev/GotSaeng-OS/gotsaeng-os
git rm -r -q .                                                 # clear tracked files (.git is kept)
git -C ../gotsaeng-os-dev archive HEAD | tar -x -C .           # extract dev's tracked files only
git add -A
git commit -m "Release <version>"
```

Why this shape:

- `git archive HEAD` exports **tracked files only** — untracked/ignored dev artifacts
  (`.vault-notes/`, `.vault-copy/`, `.omc/`, `node_modules/`, `dist/`, `coverage/`) are excluded
  automatically.
- Clearing tracked files first means files deleted in dev do not linger in public.
- `.vault-notes/` holds personal vault material (the release journal that gets copied into the
  local Obsidian vault). It is **gitignored** in dev, so `git archive HEAD` excludes it
  automatically — no manual removal step is needed.
- **`docs/launch.md` is always overwritten with dev's generic outreach-copy draft by this step —
  fix it before committing, don't skip this.** Dev keeps a channel-agnostic, version-agnostic
  draft workspace at this path (Show HN / Reddit / Discussion copy); public instead needs a
  concise, ship-ready Launch Kit with this release's actual facts (tag, exact npm versions per
  package, release assets, a launch checklist). Rewrite `docs/launch.md` on the public checkout
  with those facts — see any previous release's version in the public repo's git history
  (`git log -- docs/launch.md`) for the format — **before** the `git add -A` / commit above, or
  the wholesale overwrite ships the wrong content and nobody notices until the next audit.
- Run the **Pre-Publish Safety Scan** (below) in the public repo before pushing.
- Public `main` carries a GitHub ruleset requiring a PR with passing status checks — a direct
  `git push` is rejected (`GH013: Repository rule violations`). Push to a branch and open a PR
  against public `main` instead, wait for both `Quality (Node 20)`/`Quality (Node 22)` checks,
  then squash-merge (keeps the existing one-commit-per-release history):
  ```bash
  git checkout -b release-<version>
  git push -u origin release-<version>
  gh pr create --repo wonkwonlee/gotsaeng-os --base main --head release-<version> \
    --title "Release <version>" --body "Sync from dev for the <version> release."
  gh pr checks <pr-number> --repo wonkwonlee/gotsaeng-os --watch
  gh pr merge <pr-number> --repo wonkwonlee/gotsaeng-os --squash --delete-branch
  git checkout main && git pull --ff-only origin main
  ```

---

## Release Checklist

1. **Bump versions** — update every location in the table above to the new version.
2. **Commit** the version bump on `main` in `gotsaeng-os-dev`.
3. **Run quality gates locally:**
   ```bash
   pnpm typecheck && pnpm test && pnpm build && pnpm lint
   ```
4. **Sync to the public repository**, including rewriting `docs/launch.md` with this release's
   facts before committing (see "Dev → Public Repository Sync" above), then push via a PR (public
   `main` rejects direct pushes) and squash-merge once its checks pass.
5. **Tag on the public repository** (bare version, no `v` prefix):
   ```bash
   git tag 0.11.1
   git push origin 0.11.1
   ```
6. The tag push triggers `.github/workflows/release.yml` on the public repository:
   - Quality job runs first (`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint`).
   - Publish job runs only after quality passes.
   - **`@gotsaeng/core` is published first**, then `@gotsaeng/cli`, then `@gotsaeng/mcp`.

---

## Publish Order: Core Before CLI and MCP

Both `@gotsaeng/cli` and `@gotsaeng/mcp` declare `@gotsaeng/core` as a dependency.
Publishing either before core creates a window where npm resolves it against a stale core version.
The workflow enforces: **core → cli → mcp**, with no manual intervention required.

---

## Half-Published State (Rollback)

npm versions are **immutable** — a published version cannot be overwritten or unpublished after 72 hours.

If `@gotsaeng/core` publishes successfully but `@gotsaeng/cli` or `@gotsaeng/mcp` fails:

1. **Do not attempt to re-publish under the same version.**
2. **Fix the root cause** in the source.
3. **Bump all three packages to the next patch version in lockstep** (e.g. `0.11.0` → `0.11.1`).
   Even though core is already live and correct at the old version, all three packages must move
   together to maintain a consistent publish set.
4. **Update every version-agreement source** (see invariant table above).
5. Commit, tag the new version, push — the workflow re-runs cleanly.

> The same lockstep rule applies if cli or mcp publishes but core fails (unlikely given the enforced
> order, but possible if core's publish step succeeds then the registry rejects it post-upload).

---

## Coverage (Maintainer Signal)

Run coverage locally to check test health — it is not published as a public badge:

```bash
pnpm test:coverage
```

This uses `@vitest/coverage-v8`. Reports are written to `coverage/` (gitignored).
No coverage threshold is enforced in CI; it is a maintainer tool only.

---

## Package Readiness

GotSaeng OS is structured for package publishing:

- `@gotsaeng/core` — framework compiler API (public).
- `@gotsaeng/cli` — `gotsaeng` command (public).
- `@gotsaeng/mcp` — `gotsaeng-mcp` stdio MCP server (public).
- `apps/obsidian-plugin` — private desktop-only Obsidian adapter.

`@gotsaeng/shared` was removed after 0.10.8. It held two branding constants that nothing
imported, while costing a version bump and a tsconfig path alias every release.

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

Run these only after quality gates pass and OIDC trusted publishers are configured. No
`--provenance`: that flag only generates provenance on a supported CI/CD system (GitHub Actions,
etc.) — configuring a Trusted Publisher does not hand a local shell the CI OIDC identity these
commands would need, and `npm publish --provenance` throws `EUSAGE` without it. The CI-driven
release keeps `--provenance`; this manual fallback is for authenticated local publishing only.

```bash
pnpm --filter @gotsaeng/core publish --access public
pnpm --filter @gotsaeng/cli publish --access public
pnpm --filter @gotsaeng/mcp publish --access public
```

`apps/obsidian-plugin` has `"private": true` and must never be published.
