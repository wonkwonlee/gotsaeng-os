# GotSaeng OS 0.12.0 Launch Kit

Use this copy only for the public `0.12.0` release. It does not submit, post, or publish anything.

## Release truth

- Tag: [`0.12.0`](https://github.com/wonkwonlee/gotsaeng-os/releases/tag/0.12.0)
- npm: `@gotsaeng/cli@0.12.0`, `@gotsaeng/core@0.12.0`, and `@gotsaeng/mcp@0.12.0` (new this
  release — a stdio [Model Context Protocol](https://modelcontextprotocol.io) server exposing 5
  tools so MCP clients like Claude Code and Codex can call GotSaeng OS directly)
- Obsidian release assets: `main.js`, `manifest.json`, and `styles.css`
- Scope: local-first Markdown context compilation; no telemetry, cloud sync, or LLM API calls

Before posting, run `pnpm check:versions && pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm format:check && pnpm smoke:release` from the public repository. Confirm the tag, npm versions, release assets, and linked destination are still current.

## Canonical description

> GotSaeng OS compiles a local Markdown or Obsidian vault into structured context packs for human and LLM-assisted workflows. It runs locally: no telemetry, no cloud sync, and no LLM API calls. Provenance, confidence, and contradiction reports are deterministic review heuristics, not semantic AI verification. As of 0.12.0, it's also available as an MCP server so AI coding agents can call it as a structured tool.

## Copyable commands

CLI:

```bash
npx -y @gotsaeng/cli@0.12.0 compile ./examples/sample-vault --output ./out --project "GotSaeng OS"
```

MCP (Claude Code):

```bash
claude mcp add gotsaeng -- npx -y @gotsaeng/mcp@0.12.0 \
  --vault /absolute/path/to/vault --output /absolute/path/to/output --project "My Project"
```

The CLI command creates 15 Markdown and JSON artifacts. See `examples/README.md` for the
sample-vault walkthrough and expected output, and `docs/mcp.md` for the full MCP tool reference.

## Obsidian Community Plugin status

Already listed in the community directory (`community-plugins.json`, entry `gotsaeng-os`) but
**not yet manually reviewed by Obsidian staff** — that disclaimer currently shows in the directory
listing. No resubmission is needed for version updates: the directory reads `manifest.json` /
`versions.json` from this repo's default-branch HEAD and the matching GitHub Release, both already
correct for `0.12.0`. Do not claim "in review" or "approved" beyond what the directory portal
itself shows.

## Curated-list entries

- **awesome-local-first:** `- [GotSaeng OS](https://github.com/wonkwonlee/gotsaeng-os) - Local-first Markdown context compiler for portable, auditable context packs. No cloud, telemetry, or LLM API calls.`
- **awesome-obsidian:** `- [GotSaeng OS](https://github.com/wonkwonlee/gotsaeng-os) - Desktop-only Obsidian plugin and CLI that compile local Markdown vaults into structured context packs.`

Check each list's contribution rules and current category before opening a pull request.

## Launch checklist

- [ ] Current quality and release checks pass.
- [ ] README command and sample output work from a clean install.
- [ ] GitHub Release and npm package versions (`@gotsaeng/core`, `@gotsaeng/cli`,
      `@gotsaeng/mcp`) are all `0.12.0`.
- [ ] Obsidian community directory listing still shows this repo; note the "not manually
      reviewed" status accurately rather than implying full approval.
- [ ] Announcement copy retains the local-only and heuristic limitations above.
