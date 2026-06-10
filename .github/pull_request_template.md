## Summary

## Affected surface

- [ ] `packages/core` compiler behavior
- [ ] `packages/cli` command behavior
- [ ] `apps/obsidian-plugin` desktop adapter shell
- [ ] Documentation/examples only

## Testing

- [ ] pnpm typecheck
- [ ] pnpm test
- [ ] pnpm build
- [ ] pnpm lint

## Architecture boundaries

- [ ] Core compiler behavior remains in `packages/core`
- [ ] CLI-only behavior remains in `packages/cli`
- [ ] Obsidian adapter shell work remains in `apps/obsidian-plugin`
- [ ] The Obsidian adapter does not reimplement core compiler behavior

## Security and privacy

- [ ] No telemetry added
- [ ] No hidden network calls added
- [ ] No credential collection added
- [ ] No cloud sync added
- [ ] No LLM API calls added
