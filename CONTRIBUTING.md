# Contributing

Thanks for helping build GotSaeng OS.

## Development

Use pnpm and Node.js 20 or newer.

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm lint
```

## Scope

GotSaeng OS v0.10 is a local-first, compiler-first Markdown context compiler. Contributions should
preserve the current local-only release boundary: no cloud sync, telemetry, credential collection,
hidden network calls, LLM API calls, or broad productivity-app features unless a future roadmap item
explicitly opens that scope.

## Architecture Boundaries

- Put compiler behavior in `packages/core`.
- Put CLI command parsing, console output, exit codes, and user-facing terminal errors in
  `packages/cli`.
- Put Obsidian adapter shell behavior in `apps/obsidian-plugin` and delegate compilation to
  `packages/core` instead of reimplementing compiler logic.

## Pull Requests

- Keep changes focused and reviewable.
- Add or update tests for behavior changes.
- Update docs when public behavior changes.
- Explain security or privacy implications when relevant.
- Run `pnpm typecheck`, `pnpm test`, `pnpm build`, and `pnpm lint` before requesting review.
