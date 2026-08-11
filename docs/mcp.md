# MCP Server

`@gotsaeng/mcp` is a stdio [Model Context Protocol](https://modelcontextprotocol.io) server that
exposes GotSaeng OS as structured tools for MCP clients — Claude Code, Codex, Cursor, and similar
agent tooling — instead of those clients shelling out to the `gotsaeng` CLI. It is a thin adapter
over `packages/core`, the same architectural role as `packages/cli` and `apps/obsidian-plugin`: it
contains no compiler logic of its own.

**Status:** bootstrap-published (target v0.13 for the first real release). `@gotsaeng/mcp@0.0.1`
was published on 2026-08-11 as the one-time bootstrap publish documented in the "bootstrap
publish" section of `docs/release.md` — its sole purpose is to make the package exist so its npm
Trusted Publisher (OIDC) can be configured; it is not meant to be installed or used. Because it
was the package's first-ever published version, npm assigned it the `latest` dist-tag too (in
addition to `bootstrap`) and npm does not allow removing the only `latest` tag a package has, so
**`npx @gotsaeng/mcp` currently resolves to the placeholder `0.0.1` bootstrap build** until the
real v0.13 release publishes a higher version through CI and reclaims `latest`. Until then, run
from source (see "Running it" below). See the Phase C checklist in
`docs/superpowers/plans/2026-08-11-mcp-roadmap.md` for what remains (Trusted Publisher
registration, then the real release).

## Why a separate package, not an Obsidian plugin feature

MCP is not a replacement for a terminal — it lets an AI client call GotSaeng OS as a structured
tool. The Obsidian plugin stays focused on the end-user UI (commands, settings, Report Hub); MCP
is a developer/agent-facing surface, so it lives in its own package that reuses `packages/core`
the same way the CLI does, rather than being bolted onto the plugin.

```text
Terminal / Obsidian Terminal        -> gotsaeng CLI          -> @gotsaeng/core
Claude Code / Codex / Cursor (MCP)  -> @gotsaeng/mcp server  -> @gotsaeng/core
Obsidian plugin                     -> (direct import)       -> @gotsaeng/core
```

## Running it

```bash
node packages/mcp/dist/index.js \
  --vault /path/to/vault \
  --output /path/to/output-dir \
  --project "My Project" \
  --stale-days 90   # optional, defaults to 90
```

The vault and output roots are fixed at launch and cannot be changed by a tool call — see
"Security model" below. Build first with `pnpm --filter @gotsaeng/mcp build`.

### Client configuration

Claude Code (`claude mcp add`):

```bash
claude mcp add gotsaeng -- node /absolute/path/to/packages/mcp/dist/index.js \
  --vault /absolute/path/to/vault --output /absolute/path/to/output --project "My Project"
```

Generic MCP client config (Claude Desktop, Codex, etc. — adjust to your client's config format):

```json
{
  "mcpServers": {
    "gotsaeng": {
      "command": "node",
      "args": [
        "/absolute/path/to/packages/mcp/dist/index.js",
        "--vault",
        "/absolute/path/to/vault",
        "--output",
        "/absolute/path/to/output",
        "--project",
        "My Project"
      ]
    }
  }
}
```

## Tools

All five tools return JSON text content. On failure, the tool result has `isError: true` with a
plain-text error message — the server never throws an unhandled error across the MCP boundary.

### `validate_vault`

Validates Markdown note frontmatter in the configured vault.

- Input: `{ strict?: boolean }` (default `false`, matching the CLI's default)
- Output: `{ filesChecked, mode, status, warningCount, errorCount, warnings, errors, truncated }`
  — `warnings`/`errors` are capped at 50 entries each; `truncated` reflects capping.

### `compile_context_pack`

Compiles the configured vault into a context pack in the configured output directory.

- Input: `{}` (no arguments — vault/output/project/staleDays all come from launch config)
- Output: `{ project, outputRoot, filesScanned, markdownFilesParsed, itemCounts, warningCount, parseErrorCount, artifacts }`
  where `artifacts` is `[{ name, bytes, sha256 }]` for every generated file — never file contents.

### `list_context_artifacts`

Lists artifacts from the most recent compile's `ARTIFACT_INDEX.json`.

- Input: `{}`
- Output: `{ compiled: boolean, artifacts: [{ name, bytes, description }] }` — `compiled: false`
  with an empty list before the first `compile_context_pack` call.

### `read_context_artifact`

Reads one compiled artifact by name, capped in size.

- Input: `{ name: string, maxBytes?: number }` — `maxBytes` defaults to 65536, clamped to
  `[1, 262144]`. `name` must appear in `list_context_artifacts`; anything else is rejected.
- Output: `{ name, bytes, returnedBytes, truncated, sha256, note, content }` — `note` is a fixed
  string stating the content is untrusted vault data, not instructions.

### `prepare_ai_handoff`

Compiles and writes `LLM_HANDOFF.md`, bundling only the report sections the caller selects.

- Input: `{ sections?: string[] }` — defaults to the standard six sections (Project Context,
  Memory Snapshot, Decision Log, Action Backlog, Risk Register, Open Questions). Unknown section
  names are rejected with the list of valid ones.
- Output: `{ path, bytes, sha256, sections, note }` — metadata only, never the handoff body. The
  call adds `LLM_HANDOFF.md` to `ARTIFACT_INDEX.json` itself (core's compiler doesn't know about
  handoff files, so `compile_context_pack` can't do this), so the client can read the body
  immediately via `read_context_artifact`, or a human can open `path` directly. A later
  `compile_context_pack` call rebuilds the index from its own fixed report list and drops the
  entry again — re-run `prepare_ai_handoff` after compiling if you need it indexed once more.

## Security model

Three principles, carried over unchanged from the pre-implementation design review:

1. **Read/compile only.** Tools never modify the source vault. All writes go to the configured
   local output directory.
2. **Source notes are untrusted data, not instructions.** Vault text is data to compile and
   summarize, never something the server executes as commands. Tool descriptions and read/handoff
   results state this boundary explicitly (`packages/mcp/src/tools/artifacts.ts`'s
   `UNTRUSTED_CONTENT_NOTE`).
3. **Explicit selection over auto-injection.** `prepare_ai_handoff` never bundles the entire vault
   automatically — the caller selects sections and stays within the artifact size cap.

Implementation details that enforce these principles:

- **No network listener.** The server speaks JSON-RPC over stdin/stdout only — no HTTP, no SSE, no
  open port.
- **Fixed roots, no per-call paths.** `--vault`/`--output` are set once at process launch
  (`packages/mcp/src/config.ts` `resolveServerConfig`). No tool argument can name an arbitrary
  filesystem path.
- **Single path-allowlist chokepoint.** Every artifact read or write resolves through
  `resolveArtifactPath`, which rejects nested paths, `..` traversal, and absolute names — an
  artifact name must be a bare file name inside the configured output root.
- **Index-gated reads.** `read_context_artifact` only serves files listed in the current
  `ARTIFACT_INDEX.json`; it will not read arbitrary files even if they exist in the output
  directory.
- **Size caps.** Reads are capped at 256 KiB (default 64 KiB); result payloads never include full
  vault contents.

## Related

- `docs/architecture.md` — module boundaries, including where `packages/mcp` sits relative to
  `packages/core`, `packages/cli`, and `apps/obsidian-plugin`.
- `docs/security-audit.md` — MCP and Authentication Boundary section.
- `docs/superpowers/plans/2026-08-11-mcp-roadmap.md` — phased implementation plan and decisions.
