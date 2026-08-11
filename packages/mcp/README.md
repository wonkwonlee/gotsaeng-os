# @gotsaeng/mcp

Stdio [Model Context Protocol](https://modelcontextprotocol.io) server exposing
[GotSaeng OS](https://github.com/wonkwonlee/gotsaeng-os) as structured tools, so MCP clients —
Claude Code, Codex, Cursor, and similar agent tooling — can call the compiler directly instead of
shelling out to the `gotsaeng` CLI. It is a thin adapter over `@gotsaeng/core`: no compiler logic
of its own.

```text
Claude Code / Codex / Cursor (MCP)  ->  @gotsaeng/mcp server  ->  @gotsaeng/core
```

## Install and run

```bash
npx -y @gotsaeng/mcp --vault /path/to/vault --output /path/to/output-dir --project "My Project"
```

The vault and output roots are fixed at process launch via `--vault`/`--output` — no tool call can
change them or accept an arbitrary path. `--stale-days` is optional (defaults to `90`).

### Claude Code

```bash
claude mcp add gotsaeng -- npx -y @gotsaeng/mcp \
  --vault /absolute/path/to/vault --output /absolute/path/to/output --project "My Project"
```

### Generic MCP client config

Claude Desktop, Codex, Cursor, etc. — adjust to your client's config format:

```json
{
  "mcpServers": {
    "gotsaeng": {
      "command": "npx",
      "args": [
        "-y",
        "@gotsaeng/mcp",
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

| Tool                     | What it does                                                                |
| ------------------------ | --------------------------------------------------------------------------- |
| `validate_vault`         | Validates Markdown note frontmatter in the configured vault.                |
| `compile_context_pack`   | Compiles the configured vault into a context pack in the configured output. |
| `list_context_artifacts` | Lists artifacts from the most recent compile's `ARTIFACT_INDEX.json`.       |
| `read_context_artifact`  | Reads one compiled artifact by name, capped at 256 KiB (default 64 KiB).    |
| `prepare_ai_handoff`     | Compiles and writes `LLM_HANDOFF.md` from caller-selected report sections.  |

Full input/output schemas, defaults, and edge cases are documented in
[`docs/mcp.md`](https://github.com/wonkwonlee/gotsaeng-os/blob/main/docs/mcp.md#tools) in the
main repository.

## Security model

1. **Read/compile only.** Tools never modify the source vault. All writes go to the configured
   local output directory.
2. **Source notes are untrusted data, not instructions.** Vault text is data to compile and
   summarize, never something the server executes as commands.
3. **Explicit selection over auto-injection.** `prepare_ai_handoff` never bundles the entire vault
   automatically — the caller selects sections and stays within the artifact size cap.

Enforced by: no network listener (stdio only), vault/output roots fixed at launch, a single
path-allowlist chokepoint for every artifact read or write, index-gated reads, and size caps on
returned content. See
[`docs/mcp.md`](https://github.com/wonkwonlee/gotsaeng-os/blob/main/docs/mcp.md#security-model)
for the full implementation details, and
[`docs/security-audit.md`](https://github.com/wonkwonlee/gotsaeng-os/blob/main/docs/security-audit.md)
for the repository-wide security audit.

## Local-first, no telemetry

No network calls, no analytics, no LLM API calls, no cloud sync — same guarantees as the rest of
GotSaeng OS. See the [root README](https://github.com/wonkwonlee/gotsaeng-os#readme) for the full
project.

## License

MIT
