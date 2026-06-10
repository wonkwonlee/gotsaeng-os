# Security and Privacy Audit Notes

Last reviewed: 2026-06-09.

## Scope

This audit covers the v0.10 local release surface:

- `packages/core`
- `packages/cli`
- `apps/obsidian-plugin`
- public documentation and GitHub templates
- production dependency graph from `pnpm list --prod -r --depth 2`

It verifies product behavior claims: no telemetry, no hidden network calls, no credential
collection, no cloud sync, and no current LLM API calls. It is not a substitute for a package CVE
or supply-chain audit before publishing.

## Runtime Behavior Findings

- The compiler reads Markdown files from a user-selected local folder and writes generated context
  files to a local output folder.
- The CLI exposes local `compile`, `validate`, and `doctor` commands.
- The Obsidian adapter is desktop-only and delegates compilation to `packages/core`.
- The `Export LLM Handoff` Obsidian command writes a local handoff document; it does not call an LLM
  provider or upload content.
- No source imports or calls were found for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`,
  `node:http`, `node:https`, `node:net`, or `node:tls`.
- No runtime code path was found for telemetry, analytics, credential collection, cloud sync, or
  current LLM API behavior.

## Production Dependency Surface

Current production dependencies are limited to local parsing, file scanning, validation, and CLI
command handling:

- `fast-glob`
- `gray-matter`
- `zod`
- `commander`
- workspace package links between `@gotsaeng/core`, `@gotsaeng/cli`, and the private Obsidian
  adapter

No production dependency is an analytics SDK, telemetry SDK, cloud sync client, auth client, vector
database, RAG framework, or LLM provider SDK.

## Documentation Claim Boundaries

GotSaeng OS reports provenance, confidence, and contradiction candidates using deterministic local
metadata and text cues. These reports are review queues and quality heuristics, not semantic fact
verification.

Keep public language aligned with these boundaries:

- say "deterministic candidate" rather than "verified contradiction"
- say "metadata-based provenance/confidence" rather than "truth score"
- say "local handoff export" rather than "LLM integration"
- keep future AI language optional, explicit, and downstream of compiled context packs

## Repeatable Audit Commands

```bash
rg -n --glob '!node_modules/**' --glob '!dist/**' --glob '!**/*.map' --glob '!pnpm-lock.yaml' \
  '\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|http:|https:|node:http|node:https|node:net|node:tls|analytics|telemetry|sentry|posthog|api[_-]?key|secret|token|credential|password|OPENAI|ANTHROPIC|GEMINI|llm|cloud|sync)\b' \
  packages apps docs README.md SECURITY.md CONTRIBUTING.md .github package.json packages/*/package.json apps/*/package.json

pnpm list --prod -r --depth 2
```

Expected keyword-scan matches are documentation/package metadata, scope guardrails, and the local
Obsidian `export-llm-handoff` command name. Any new runtime network/client SDK import should be
reviewed before release.
