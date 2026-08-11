# GotSaeng OS 0.11.0 Launch Kit

Use this copy only for the public `0.11.0` release. It does not submit, post, or publish anything.

## Release truth

- Tag: [`0.11.0`](https://github.com/wonkwonlee/gotsaeng-os/releases/tag/0.11.0)
- npm: `@gotsaeng/cli@0.11.0` and `@gotsaeng/core@0.11.0`
- Obsidian release assets: `main.js`, `manifest.json`, and `styles.css`
- Scope: local-first Markdown context compilation; no telemetry, cloud sync, or LLM API calls

Before posting, run `pnpm check:versions && pnpm typecheck && pnpm test && pnpm build && pnpm lint && pnpm format:check && pnpm smoke:release` from the public repository. Confirm the tag, npm versions, release assets, and linked destination are still current.

## Canonical description

> GotSaeng OS compiles a local Markdown or Obsidian vault into structured context packs for human and LLM-assisted workflows. It runs locally: no telemetry, no cloud sync, and no LLM API calls. Provenance, confidence, and contradiction reports are deterministic review heuristics, not semantic AI verification.

## Copyable command

```bash
npx -y @gotsaeng/cli@0.11.0 compile ./examples/sample-vault --output ./out --project "GotSaeng OS"
```

The command creates 15 Markdown and JSON artifacts. See `examples/README.md` for the sample-vault walkthrough and expected output.

## Obsidian Community Plugin submission

The community directory submission is owner-controlled. Do not claim that it is in review unless the portal confirms it.

1. Sign in at <https://community.obsidian.md> and link the owning GitHub account.
2. Submit `https://github.com/wonkwonlee/gotsaeng-os` through **Plugins → New plugin**.
3. Complete the directory checks and respond to reviewer feedback with a new versioned release when required.

See `docs/public/obsidian-submission.md` for the full process and desktop-only rationale.

## Curated-list entries

- **awesome-local-first:** `- [GotSaeng OS](https://github.com/wonkwonlee/gotsaeng-os) - Local-first Markdown context compiler for portable, auditable context packs. No cloud, telemetry, or LLM API calls.`
- **awesome-obsidian:** `- [GotSaeng OS](https://github.com/wonkwonlee/gotsaeng-os) - Desktop-only Obsidian plugin and CLI that compile local Markdown vaults into structured context packs.`

Check each list's contribution rules and current category before opening a pull request.

## Launch checklist

- [ ] Current quality and release checks pass.
- [ ] README command and sample output work from a clean install.
- [ ] GitHub Release and npm package versions are `0.11.0`.
- [ ] Obsidian submission status is stated only from the directory portal.
- [ ] Announcement copy retains the local-only and heuristic limitations above.
