# Security and Privacy Audit Notes

Last reviewed: 2026-08-08.

## Scope

This audit covers the current local release surface:

- `packages/core`
- `packages/cli`
- `apps/obsidian-plugin`
- public documentation and GitHub templates
- production dependency graph from `pnpm list --prod -r --depth 2`

It verifies product behavior claims: no telemetry, no hidden network calls, no credential
collection, no cloud sync, and no current LLM API calls. It is not a substitute for a package CVE
or supply-chain audit before publishing.

## MCP and Authentication Boundary

The repository contains no OAuth flow, bearer-token handling, or plugin authentication. The
Obsidian adapter stores only local plugin settings through Obsidian's `loadData()`/`saveData()`
APIs and does not authenticate to a service.

`packages/mcp` (`@gotsaeng/mcp`, published — `0.12.0` is the real release and holds the `latest`
dist-tag; a `0.0.1` bootstrap placeholder tagged `bootstrap` also exists solely because it was
needed to enable Trusted Publisher setup and should not be installed; see `docs/mcp.md`) is a
stdio MCP server. It has no network listener: it speaks JSON-RPC over
stdin/stdout to whatever local MCP client launched it (e.g. Claude Code, Codex), the same way the
CLI is invoked as a subprocess. There is no HTTP/SSE transport, no OAuth, and no credential
storage. Its vault and output roots are fixed at process launch via `--vault`/`--output` CLI
arguments and cannot be changed by tool calls; every tool-supplied file name is resolved through a
single allowlist chokepoint (`resolveArtifactPath` in `packages/mcp/src/config.ts`) that rejects
paths outside the configured output root. The server only reads the vault and writes to the
configured output directory — it never writes into the vault. Tool descriptions and read/handoff
results state that vault content is untrusted data, not instructions, matching this project's
`workflows.md` handoff-language guardrails.

The only authentication-related release mechanism is npm Trusted Publisher OIDC in the public
repository's tag-triggered workflow. It publishes `@gotsaeng/core`, `@gotsaeng/cli`, and
`@gotsaeng/mcp`. `@gotsaeng/mcp`'s one-time manual bootstrap publish (`0.0.1`, npm
Automation/Granular-Access-Token auth, no OIDC) was a prerequisite step: it made the package's npm
Settings page exist so its Trusted Publisher could be registered, which has since happened, and
the Release 0.12.0 CI publish went out through this same OIDC workflow — see the Phase C checklist
in `docs/superpowers/plans/2026-08-11-mcp-roadmap.md` and the "bootstrap publish" section in
`docs/release.md`. Development repositories must not be tagged for release. MCPs configured in a
developer's global Codex or Claude environment are outside this repository's product and release
boundary and must not be copied into project files.

## Runtime Behavior Findings

- The compiler reads Markdown files from a user-selected local folder and writes generated context
  files to a local output folder.
- The CLI exposes local `compile`, `validate`, and `doctor` commands.
- The MCP server (`packages/mcp`) exposes `validate_vault`, `compile_context_pack`,
  `list_context_artifacts`, `read_context_artifact`, and `prepare_ai_handoff` as MCP tools over
  stdio; it delegates all compilation to `packages/core`, same as the CLI.
- The Obsidian adapter is desktop-only and delegates compilation to `packages/core`.
- The `Export LLM Handoff` Obsidian command writes a local handoff document; it does not call an LLM
  provider or upload content.
- No source imports or calls were found for `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`,
  `node:http`, `node:https`, `node:net`, or `node:tls`.
- No runtime code path was found for telemetry, analytics, credential collection, cloud sync, or
  current LLM API behavior.

## Production Dependency Surface

Production dependencies are limited to local parsing, file scanning, validation, CLI command
handling, and the MCP stdio protocol implementation:

- `fast-glob`
- `gray-matter`
- `zod`
- `commander`
- `@modelcontextprotocol/sdk` (`packages/mcp`, published as `@gotsaeng/mcp@0.12.0` — see `docs/mcp.md`)
- workspace package links between `@gotsaeng/core`, `@gotsaeng/cli`, `@gotsaeng/mcp`, and the
  private Obsidian adapter

No production dependency is an analytics SDK, telemetry SDK, cloud sync client, auth client, vector
database, RAG framework, or LLM provider SDK.

`@modelcontextprotocol/sdk` pulls in a larger transitive surface than the other dependencies —
notably `express`, `express-rate-limit`, `cors`, `hono`, `ajv`, and `jose` — because the SDK
package supports HTTP/SSE server transports in addition to stdio. `packages/mcp/src` imports only
the SDK's stdio subpaths (`server/mcp.js`, `server/stdio.js`; `client/index.js` and `inMemory.js`
in tests only), so none of that HTTP-transport code is reachable from this package's entry point —
but `pnpm list --prod -r --depth 2` still reports the full graph, since it reflects what's
installed, not what's imported. Re-verify this claim (no `express`/`cors`/`hono` import in
`packages/mcp/src`) whenever the SDK is upgraded.

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
