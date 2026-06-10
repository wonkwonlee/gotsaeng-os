# @gotsaeng/cli

Command-line interface for GotSaeng OS.

The `gotsaeng` command compiles local Markdown vaults into auditable context packs, validates vault
schema compatibility, and runs a small local doctor check.

It does not call LLM APIs, upload notes, add telemetry, or sync data.

## Install

```bash
npm install -g @gotsaeng/cli
```

## Usage

```bash
gotsaeng doctor
gotsaeng validate ./notes
gotsaeng compile ./notes --output ./context-pack --project "My Project" --stale-days 90
```

Generated output stays in the local output directory you choose.
