# GotSaeng OS MCP — Master Roadmap & Schedule (v0.12)

> **For agentic workers:** This is the umbrella schedule. Each phase has its own
> executable plan file (linked below). Execute ONE phase per session using
> superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Let MCP clients (Claude Code, Codex, Cursor) call GotSaeng OS as structured
tools — validate, compile, list/read artifacts, prepare selective AI handoffs — while
the Obsidian plugin stays the end-user UI.

**Decision record (from the 2026-08-11 review):**

- Order confirmed: strengthen CLI JSON output + artifact manifest FIRST, then one stdio
  MCP server on top.
- Handoff composition currently lives in the Obsidian plugin
  (`apps/obsidian-plugin/src/reports.ts:199` `renderLlmHandoff`). It MUST be promoted to
  `packages/core` before the MCP package exists, or MCP would reimplement core behavior
  (violates CLAUDE.md architecture principle).
- "Manifest" name is taken: `CONTEXT_MANIFEST.json` is an item-level manifest. The new
  output-file manifest is named **`ARTIFACT_INDEX.json`** (name, bytes, sha256,
  description per generated file).
- `@gotsaeng/mcp` ships **`"private": true`** in v0.12 (workspace-only experiment).
  npm publish is a separate Phase C decision (target v0.13).
- MCP server fixes vault/output roots at launch via CLI args (path allowlist). Tools
  never accept arbitrary absolute paths.

---

## Schedule (one session per phase)

| Phase                     | Plan file                               | Scope                                                                                                  | Est. effort                           | Branch                               |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------ |
| **A — v0.12a core & CLI** | `2026-08-11-v012a-core-json-handoff.md` | Promote handoff to core; add `ARTIFACT_INDEX.json`; CLI `--json` for compile/validate                  | 0.5–1 day                             | `wonkwonlee/v012a-core-json-handoff` |
| **B — v0.12b MCP server** | `2026-08-11-v012b-mcp-server.md`        | New `packages/mcp` (`@gotsaeng/mcp`, private): stdio server + 5 tools + docs updates                   | 1 day                                 | `wonkwonlee/v012b-mcp-server`        |
| **C — release plumbing**  | checklist below (no code plan needed)   | npm Trusted Publisher, public-mirror `release.yml`, version-check regex, smoke targets, flip `private` | 0.5 day, only when publishing (v0.13) | `wonkwonlee/mcp-release-plumbing`    |

Phase B depends on Phase A being merged to dev `main`. Phase C depends on B and on the
decision to publish.

## How to start each session

1. Start from the canonical checkout (`~/dev/GotSaeng-OS/gotsaeng-os-dev`) or a fresh
   worktree off dev `main`. Create the branch named above.
2. Kickoff prompt: _"Execute the plan at `docs/superpowers/plans/<phase-file>` using
   superpowers:executing-plans (or subagent-driven-development). Check off steps as you
   go."_
3. Quality gates before finishing (CLAUDE.md): `pnpm typecheck && pnpm test && pnpm build
&& pnpm lint && pnpm format:check && pnpm check:versions`.
4. Version bumps to 0.12.0 happen in the normal `Release X.Y.Z` commit at release time,
   NOT inside these phases — with one exception: the new `packages/mcp/package.json`
   must carry the root version at creation time or `check:versions` fails.
5. Do not tag this dev repo. Releases are cut on the public mirror
   (`wonkwonlee/gotsaeng-os`) per `docs/release.md`.

## Phase C checklist (only when publishing @gotsaeng/mcp — target v0.13)

- [x] Flip `packages/mcp/package.json` `"private": true` → remove, add `publishConfig.access: public`, `files: ["dist"]`, `prepack: pnpm build`.
- [x] **Bootstrap publish `@gotsaeng/mcp@0.0.1`** (2026-08-11) — one-time manual publish so the
      package exists and its npm Settings page appears. Required a Granular Access Token with
      "Bypass two-factor authentication" (the account uses WebAuthn/passkey-only 2FA — plain
      `npm login` and classic Automation tokens both hit `EOTP`/`E403`). `latest` dist-tag ended
      up pinned to the `0.0.1` placeholder (unavoidable — see "Status" note in `docs/release.md`'s
      bootstrap section) until the real release reclaims it.
- [ ] npm web UI: register **Trusted Publisher (OIDC)** for `@gotsaeng/mcp`, bound to the
      public repo's `release.yml` — BEFORE the first real tag, or publish silently fails
      (`docs/release.md:11-24`). **Manual step — must be done by a human maintainer in the
      npm web UI; not completable from this session.** Now unblocked since the bootstrap
      publish above makes the package's Settings page exist.
- [x] Public mirror `.github/workflows/release.yml`: add a third publish step
      `pnpm --filter @gotsaeng/mcp publish --access public --provenance --no-git-checks`
      ordered AFTER `@gotsaeng/core` (dependency ordering rule in workflow comments).
- [x] `scripts/check-versions.mjs:110`: extend README pin regex
      `/@gotsaeng\/(?:cli|core)@(\d+\.\d+\.\d+)/g` → `(?:cli|core|mcp)` since README now pins an
      mcp version.
- [x] `scripts/release-smoke.mjs` (~lines 90-99): add `packages/mcp` to hardcoded pack
      targets so `pnpm smoke:package` covers it.
- [x] `docs/release.md`: update version-agreement table, "Release Checklist" step 1
      ("all five locations" count), and "Package Readiness" list.
- [x] `README.md`: add `@gotsaeng/mcp` usage section (client config snippet for Claude
      Code / Codex / Cursor).

Also updated for consistency (not originally itemized above): `CLAUDE.md` Release Process
bullet (`package.json` ×4 → ×5, core→cli→mcp publish order), and `docs/release.md`'s
"Publish Order", "Half-Published State (Rollback)", and "Candidate Publish Commands"
sections to reflect three publishable packages instead of two.

Branch: `wonkwonlee/mcp-release-plumbing` (off dev `main` at `09caeba`, post-#27 merge).
All quality gates pass: typecheck, test (279 passed), build, lint, format:check,
check:versions. `pnpm smoke:package` also passes end-to-end with the new mcp tarball.

**Still outstanding before the first `@gotsaeng/mcp` tag can succeed:** the npm Trusted
Publisher registration above is a manual npm.com step that no agent session can perform —
flag it to the maintainer before cutting the v0.13 release.

## Out of scope (unchanged non-goals)

No LLM API calls, no telemetry, no cloud sync, no network listeners (stdio only), no
write access to source vault notes from MCP tools.
