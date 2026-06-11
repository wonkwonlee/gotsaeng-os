# CLAUDE.md

## Project

GotSaeng OS is a local-first context compiler for Markdown-based knowledge workflows.

## Working Agreements

- Use pnpm.
- Use strict TypeScript.
- Prefer small pure functions.
- Keep current releases local-only.
- Do not add telemetry.
- Do not add LLM API calls unless explicitly requested in a future task.
- Do not add cloud sync.
- Do not introduce new dependencies without a clear reason.
- Run tests after behavior changes.
- Update docs when changing public behavior.

## Quality Gates

Before completing a task, run:

- pnpm typecheck
- pnpm test
- pnpm build
- pnpm lint

If a command cannot run, explain why.

## Architecture Principle

Core logic belongs in packages/core.
CLI logic belongs in packages/cli.
Obsidian adapter shell work belongs in apps/obsidian-plugin.
Do not reimplement core compiler behavior inside the Obsidian adapter.
