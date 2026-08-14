# GotSaeng OS 0.12.1 Launch Kit

Use this copy only for the public `0.12.1` release. It does not submit, post, or publish anything.
This is a maintenance release (Obsidian adapter fixes, accessibility, and release-hardening) — no
new outreach push is warranted; this file exists to keep release facts and the checklist current
per `docs/release.md`.

## Release truth

- Tag: [`0.12.1`](https://github.com/wonkwonlee/gotsaeng-os/releases/tag/0.12.1)
- npm: `@gotsaeng/cli@0.12.1`, `@gotsaeng/core@0.12.1`, and `@gotsaeng/mcp@0.12.1` (no API changes
  from `0.12.0` in any package — this release is fixes and hardening, not new capability)
- Obsidian release assets: `main.js`, `manifest.json`, and `styles.css`, now with a build
  provenance attestation (`actions/attest-build-provenance`) so installers can verify the assets
  were built by this repo's `release.yml` from this repo's source — see
  `apps/obsidian-plugin/README.md`'s "Verifying a Downloaded Release Build" for the
  `gh attestation verify` commands.
- Scope: local-first Markdown context compilation; no telemetry, cloud sync, or LLM API calls

Before posting, run `pnpm check:versions && pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm format:check && pnpm smoke:release` from the public repository. Confirm the tag, npm versions, release assets, and linked destination are still current.

## What changed since 0.12.1

- Obsidian adapter (Report Hub): output-folder cleanup only sweeps folders the plugin instance has
  actually used, instead of always trusting the two built-in folder names — closes a
  silent-deletion risk. Fixed a race between the custom-path field and the visibility dropdown
  that could open duplicate confirmation dialogs, and a stale-settings bug that could leave the
  visibility label out of sync with the folder actually in use.
- Obsidian adapter (Report Hub): added `aria-pressed`/`role="group"` semantics and an accessible
  confirmation dialog, an in-progress state on long-running command buttons (respecting
  `prefers-reduced-motion`), a filter field over the Context Pack Files grid plus a new
  "Governance" subgroup so no group exceeds ~7 items, and a dismissible error banner with a
  timestamp.
- Release workflow: Obsidian plugin release assets now carry a build provenance attestation (see
  above).
- Security hardening carried over from the prior `Unreleased` cycle: symlink-safe `writeText`,
  reduced `contents: write` token exposure in `release.yml`, and a tag-targets-`main` guard.

Full detail: `CHANGELOG.md`.

## Canonical description

> GotSaeng OS compiles a local Markdown or Obsidian vault into structured context packs for human and LLM-assisted workflows. It runs locally: no telemetry, no cloud sync, and no LLM API calls. Provenance, confidence, and contradiction reports are deterministic review heuristics, not semantic AI verification. It's also available as an MCP server so AI coding agents can call it as a structured tool.

## Copyable commands

CLI:

```bash
npx -y @gotsaeng/cli@0.12.1 compile ./examples/sample-vault --output ./out --project "GotSaeng OS"
```

MCP (Claude Code):

```bash
claude mcp add gotsaeng -- npx -y @gotsaeng/mcp@0.12.1 \
  --vault /absolute/path/to/vault --output /absolute/path/to/output --project "My Project"
```

The CLI command creates 15 Markdown and JSON artifacts. See `examples/README.md` for the
sample-vault walkthrough and expected output, and `docs/mcp.md` for the full MCP tool reference.

## Obsidian Community Plugin status

Already listed in the community directory (`community-plugins.json`, entry `gotsaeng-os`) but
**not yet manually reviewed by Obsidian staff** — that disclaimer currently shows in the directory
listing. No resubmission is needed for version updates: the directory reads `manifest.json` /
`versions.json` from this repo's default-branch HEAD and the matching GitHub Release, both already
correct for `0.12.1`. Do not claim "in review" or "approved" beyond what the directory portal
itself shows.

## Curated-list entries

- **awesome-local-first:** `- [GotSaeng OS](https://github.com/wonkwonlee/gotsaeng-os) - Local-first Markdown context compiler for portable, auditable context packs. No cloud, telemetry, or LLM API calls.`
- **awesome-obsidian:** `- [GotSaeng OS](https://github.com/wonkwonlee/gotsaeng-os) - Desktop-only Obsidian plugin and CLI that compile local Markdown vaults into structured context packs.`

Check each list's contribution rules and current category before opening a pull request. No
action needed for this patch release unless an existing entry's version claim needs updating.

## Launch checklist

- [ ] Current quality and release checks pass.
- [ ] README command and sample output work from a clean install.
- [ ] GitHub Release and npm package versions (`@gotsaeng/core`, `@gotsaeng/cli`,
      `@gotsaeng/mcp`) are all `0.12.1`.
- [ ] Obsidian community directory listing still shows this repo; note the "not manually
      reviewed" status accurately rather than implying full approval.
- [ ] No outreach post needed for this maintenance release; this file's facts stay current for
      whoever checks it next.
